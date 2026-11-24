//! Karplus-Strong plucked-string synthesis (task 5.1 / PRD §9).
//!
//! The acoustic guitar voice. Karplus-Strong models a plucked string as a
//! burst of noise circulating in a delay line whose length is one period of the
//! note, passed through a gentle lowpass each trip: the delay sets the pitch,
//! the lowpass makes the high harmonics die first (the characteristic pluck),
//! and a per-trip loss sets the ring time. No samples, no licensing, and — the
//! reason it lives in the engine (ADR-0002) — it is a pure function from
//! parameters to an output buffer, so pitch, decay and boundedness are checked
//! by `cargo test` on the samples themselves, with no speakers in the loop.
//!
//! ## Model (Jaffe & Smith "extended" KS, the pieces that matter here)
//!
//! - **Excitation**: seeded white noise (xorshift, deterministic per `seed`),
//!   one-pole lowpassed by `brightness` (1 = raw noise / bright pick attack,
//!   0 = very dark / soft thumb), DC-removed and peak-normalised. The frontend
//!   maps strum velocity to brightness, so harder strums sound brighter.
//! - **Loop filter**: two-point average `½(xₙ + xₙ₋₁)` (½-sample delay, the
//!   classic KS lowpass) times a loss `ρ = 10^(−3 / (t60·f))`, chosen so the
//!   fundamental falls 60 dB after `t60` seconds (each sample makes `f` trips a
//!   second). Small `t60` (≈0.1–0.3 s) gives a palm-muted thud.
//! - **Tuning**: the loop delay must equal the period `P = sr / f`, which is
//!   rarely an integer. An integer delay line `N` plus the ½ sample of the
//!   average leaves a fraction `δ`, supplied by a first-order allpass with
//!   coefficient `C = (1−δ)/(1+δ)`; `δ` is kept in `[0.1, 1.1)` where that
//!   allpass's phase delay is accurate. Without this, high strings would be
//!   several cents sharp/flat.
//!
//! The rendered buffer is peak-normalised to 1.0 and ends with a short linear
//! fade so stopping it at the end never clicks. Loudness is the caller's gain.

use wasm_bindgen::prelude::*;

/// Lowest / highest sample rate accepted (anything else is clamped).
const MIN_SAMPLE_RATE: f64 = 8_000.0;
const MAX_SAMPLE_RATE: f64 = 192_000.0;
/// Longest buffer we'll render, in seconds.
pub const MAX_DURATION_S: f64 = 10.0;
/// Ring-time (T60) bounds, in seconds.
const MIN_T60_S: f64 = 0.01;
const MAX_T60_S: f64 = 30.0;
/// End-of-buffer fade length, in seconds.
const FADE_S: f64 = 0.01;
/// Smallest delay line we allow (very high notes would make the loop filter
/// dominate the pitch); `freq` must keep `sr/freq` above this.
const MIN_DELAY: usize = 4;

/// Parameters for one pluck. See the module docs for what each one does.
#[derive(Clone, Copy, Debug)]
pub struct PluckParams {
    /// Fundamental frequency in Hz.
    pub freq: f64,
    /// Output sample rate in Hz (the `AudioContext`'s).
    pub sample_rate: f64,
    /// Buffer length in seconds.
    pub duration: f64,
    /// Seconds for the fundamental to decay by 60 dB.
    pub t60: f64,
    /// Excitation brightness in `[0, 1]`.
    pub brightness: f64,
    /// Noise seed; equal seeds give identical buffers.
    pub seed: u32,
}

fn finite_or(x: f64, fallback: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        fallback
    }
}

/// xorshift32 step → uniform sample in `[-1, 1]`.
fn next_noise(state: &mut u32) -> f64 {
    let mut s = *state;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    *state = s;
    (s as f64 / u32::MAX as f64) * 2.0 - 1.0
}

/// Render a Karplus-Strong pluck. Returns an empty buffer when the note can't
/// be rendered (non-positive / non-finite frequency, or a frequency so high the
/// delay line would be shorter than [`MIN_DELAY`] samples); all other bad
/// parameters are clamped/sanitised so the output is always finite.
pub fn render(params: PluckParams) -> Vec<f32> {
    let sr = finite_or(params.sample_rate, 44_100.0).clamp(MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
    let freq = params.freq;
    if !freq.is_finite() || freq <= 0.0 {
        return Vec::new();
    }
    let period = sr / freq;
    // Integer delay N plus the ½-sample average plus an allpass fraction δ.
    let mut delay = (period - 0.5).floor();
    let mut frac = period - 0.5 - delay;
    if frac < 0.1 {
        delay -= 1.0;
        frac += 1.0;
    }
    if delay < MIN_DELAY as f64 {
        return Vec::new();
    }
    let n = delay as usize;
    let c = (1.0 - frac) / (1.0 + frac);

    let duration = finite_or(params.duration, 1.0).clamp(0.0, MAX_DURATION_S);
    let len = (duration * sr).round() as usize;
    if len == 0 {
        return Vec::new();
    }
    let t60 = finite_or(params.t60, 1.0).clamp(MIN_T60_S, MAX_T60_S);
    let rho = 10f64.powf(-3.0 / (t60 * freq));
    let brightness = finite_or(params.brightness, 0.5).clamp(0.0, 1.0);

    // Excitation: lowpassed, DC-free, peak-normalised noise filling the line.
    let mut seed = if params.seed == 0 { 0x9E37_79B9 } else { params.seed };
    let alpha = 0.05 + 0.95 * brightness;
    let mut line = vec![0.0f64; n];
    let mut lp = 0.0;
    for slot in line.iter_mut() {
        lp += alpha * (next_noise(&mut seed) - lp);
        *slot = lp;
    }
    let mean = line.iter().sum::<f64>() / n as f64;
    let mut peak = 0.0f64;
    for slot in line.iter_mut() {
        *slot -= mean;
        peak = peak.max(slot.abs());
    }
    if peak > 0.0 {
        for slot in line.iter_mut() {
            *slot /= peak;
        }
    }

    // Circulate: read, average with the previous read, lose ρ, allpass-tune,
    // write back.
    let mut out = Vec::with_capacity(len);
    let mut idx = 0usize;
    let mut prev = 0.0f64;
    let (mut ap_x1, mut ap_y1) = (0.0f64, 0.0f64);
    for _ in 0..len {
        let x = line[idx];
        let avg = rho * 0.5 * (x + prev);
        prev = x;
        let ap = c * avg + ap_x1 - c * ap_y1;
        ap_x1 = avg;
        ap_y1 = ap;
        line[idx] = ap;
        idx += 1;
        if idx == n {
            idx = 0;
        }
        out.push(x);
    }

    // Peak-normalise, then fade the tail so the buffer never ends on a click.
    let peak = out.iter().fold(0.0f64, |m, v| m.max(v.abs()));
    let scale = if peak > 0.0 { 1.0 / peak } else { 0.0 };
    let fade = ((FADE_S * sr) as usize).min(len / 4).max(1);
    let mut buf = Vec::with_capacity(len);
    for (i, v) in out.iter().enumerate() {
        let remaining = len - i;
        let env = if remaining <= fade {
            (remaining - 1) as f64 / fade as f64
        } else {
            1.0
        };
        buf.push((v * scale * env) as f32);
    }
    buf
}

/// WASM export: render a pluck into a `Float32Array` ready for
/// `AudioBuffer.copyToChannel`. Arguments as in [`PluckParams`]; an empty
/// array means "nothing to play".
#[wasm_bindgen(js_name = renderPluck)]
pub fn render_pluck(
    freq: f64,
    sample_rate: f64,
    duration: f64,
    t60: f64,
    brightness: f64,
    seed: u32,
) -> Vec<f32> {
    render(PluckParams {
        freq,
        sample_rate,
        duration,
        t60,
        brightness,
        seed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 44_100.0;

    fn params(freq: f64) -> PluckParams {
        PluckParams {
            freq,
            sample_rate: SR,
            duration: 1.0,
            t60: 3.0,
            brightness: 0.7,
            seed: 42,
        }
    }

    /// Estimate the fundamental from normalised autocorrelation over
    /// `[start, start+win)`, searching lags within ±20% of the expected period,
    /// refined by parabolic interpolation.
    fn estimate_freq(buf: &[f32], start: usize, win: usize, expected: f64) -> f64 {
        let p = SR / expected;
        let lo = (p * 0.8).floor() as usize;
        let hi = (p * 1.2).ceil() as usize;
        let ac = |lag: usize| -> f64 {
            let mut num = 0.0;
            let mut e0 = 0.0;
            let mut e1 = 0.0;
            for i in start..start + win {
                let a = buf[i] as f64;
                let b = buf[i + lag] as f64;
                num += a * b;
                e0 += a * a;
                e1 += b * b;
            }
            num / (e0 * e1).sqrt().max(1e-12)
        };
        let mut best = lo;
        let mut best_v = f64::MIN;
        for lag in lo..=hi {
            let v = ac(lag);
            if v > best_v {
                best_v = v;
                best = lag;
            }
        }
        let (a, b, c) = (ac(best - 1), best_v, ac(best + 1));
        let denom = a - 2.0 * b + c;
        let shift = if denom.abs() > 1e-12 { 0.5 * (a - c) / denom } else { 0.0 };
        SR / (best as f64 + shift)
    }

    fn cents(f: f64, reference: f64) -> f64 {
        1200.0 * (f / reference).log2()
    }

    fn rms(buf: &[f32]) -> f64 {
        (buf.iter().map(|v| (*v as f64).powi(2)).sum::<f64>() / buf.len() as f64).sqrt()
    }

    fn db(ratio: f64) -> f64 {
        20.0 * ratio.log10()
    }

    #[test]
    fn length_matches_duration() {
        assert_eq!(render(params(110.0)).len(), 44_100);
        let half = render(PluckParams { duration: 0.5, ..params(110.0) });
        assert_eq!(half.len(), 22_050);
    }

    #[test]
    fn pitch_is_accurate_across_the_guitar_range() {
        // Open low E, A, D, G, B, high e, plus high e at the 12th fret.
        for &f in &[82.41, 110.0, 146.83, 196.0, 246.94, 329.63, 659.26] {
            let buf = render(params(f));
            let est = estimate_freq(&buf, 4_000, 8_000, f);
            let err = cents(est, f).abs();
            assert!(err < 1.0, "f={f} est={est} err={err:.2} cents");
        }
    }

    #[test]
    fn output_is_bounded_and_finite() {
        for &f in &[82.41, 329.63, 1318.5] {
            let buf = render(params(f));
            assert!(buf.iter().all(|v| v.is_finite()));
            let peak = buf.iter().fold(0.0f32, |m, v| m.max(v.abs()));
            assert!((peak - 1.0).abs() < 1e-6, "peak {peak}");
        }
    }

    #[test]
    fn decays_at_roughly_the_requested_t60() {
        // t60 = 2 s → after 1 s the fundamental is ~−30 dB. The loop lowpass
        // also strips harmonics, so allow a band on the quieter side.
        let buf = render(PluckParams {
            duration: 1.2,
            t60: 2.0,
            ..params(110.0)
        });
        let head = rms(&buf[0..2_205]);
        let at_1s = rms(&buf[44_100 - 1_102..44_100 + 1_102]);
        let drop = db(at_1s / head);
        assert!((-42.0..=-24.0).contains(&drop), "drop {drop:.1} dB");
    }

    #[test]
    fn short_t60_is_a_muted_thud() {
        let ringing = render(params(110.0));
        let muted = render(PluckParams { t60: 0.15, ..params(110.0) });
        let window = 13_230..15_435; // ~0.30–0.35 s
        let r = rms(&ringing[window.clone()]);
        let m = rms(&muted[window]);
        assert!(db(m / rms(&muted[0..2_205])) < -40.0);
        assert!(m < r * 0.05, "muted {m} vs ringing {r}");
    }

    #[test]
    fn buffer_ends_silent() {
        let buf = render(params(196.0));
        assert_eq!(*buf.last().unwrap(), 0.0);
        // and the fade is monotone over its last few samples
        let n = buf.len();
        assert!(buf[n - 2].abs() <= buf[n - 400].abs() + 1e-3);
    }

    #[test]
    fn brighter_excitation_has_more_high_frequency_energy() {
        // First-difference energy / energy is a cheap spectral-tilt proxy.
        let tilt = |b: f64| {
            let buf = render(PluckParams { brightness: b, ..params(110.0) });
            let seg = &buf[0..2_000];
            let diff: f64 = seg.windows(2).map(|w| ((w[1] - w[0]) as f64).powi(2)).sum();
            let energy: f64 = seg.iter().map(|v| (*v as f64).powi(2)).sum();
            diff / energy
        };
        assert!(tilt(1.0) > tilt(0.0) * 3.0);
    }

    #[test]
    fn deterministic_per_seed() {
        let a = render(params(146.83));
        let b = render(params(146.83));
        assert_eq!(a, b);
        let c = render(PluckParams { seed: 7, ..params(146.83) });
        assert_ne!(a, c);
        // seed 0 is remapped, not a degenerate all-zero noise source
        let z = render(PluckParams { seed: 0, ..params(146.83) });
        assert!(rms(&z) > 0.01);
    }

    #[test]
    fn has_no_dc_offset() {
        let buf = render(params(110.0));
        let mean = buf[0..4_410].iter().map(|v| *v as f64).sum::<f64>() / 4_410.0;
        assert!(mean.abs() < 0.02, "mean {mean}");
    }

    #[test]
    fn unrenderable_notes_give_empty_buffers() {
        assert!(render(params(0.0)).is_empty());
        assert!(render(params(-110.0)).is_empty());
        assert!(render(params(f64::NAN)).is_empty());
        assert!(render(params(f64::INFINITY)).is_empty());
        // delay line would be < MIN_DELAY samples
        assert!(render(params(SR / 3.0)).is_empty());
        assert!(render(PluckParams { duration: 0.0, ..params(110.0) }).is_empty());
    }

    #[test]
    fn bad_parameters_are_sanitised() {
        let buf = render(PluckParams {
            freq: 110.0,
            sample_rate: f64::NAN,
            duration: f64::NAN,
            t60: f64::NAN,
            brightness: f64::NAN,
            seed: 1,
        });
        assert!(!buf.is_empty());
        assert!(buf.iter().all(|v| v.is_finite()));
        let huge = render(PluckParams { duration: 1e9, ..params(110.0) });
        assert_eq!(huge.len(), (MAX_DURATION_S * SR) as usize);
        let neg = render(PluckParams { t60: -5.0, brightness: 9.0, ..params(110.0) });
        assert!(neg.iter().all(|v| v.is_finite()));
    }

    #[test]
    fn wasm_export_matches_core() {
        let p = params(220.0);
        assert_eq!(
            render_pluck(p.freq, p.sample_rate, p.duration, p.t60, p.brightness, p.seed),
            render(p)
        );
    }
}
