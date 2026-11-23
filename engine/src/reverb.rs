//! Algorithmic reverb impulse response (task 5.3 / PRD §9).
//!
//! The reverb is a Web Audio `ConvolverNode`; what makes it sound like a room
//! is the impulse response (IR) it convolves with. Rather than ship a recorded
//! IR (licensing, download size on a slow link — ADR-0001/0005), the engine
//! synthesises one: a short pre-delay, then noise under an exponential decay
//! envelope, progressively lowpassed so the tail gets darker as it dies — the
//! two features that separate "a room" from "a noise burst". Pure and
//! deterministic per seed (ADR-0002), so the envelope, darkening, energy and
//! channel decorrelation are `cargo test`-ed on the samples.
//!
//! ## Model
//!
//! - `pre-delay` = 8 ms of silence (direct sound arrives before reflections).
//! - Envelope `e^{−ln(1000)·t / duration}`: −60 dB at `duration` (an RT60).
//! - One-pole lowpass whose coefficient slides from `bright` (0.9) down to
//!   `bright·(1−damping)` over the tail, with `damping ∈ [0,1]`.
//! - Normalised to **unit energy** (Σx² = 1), so with the convolver's own
//!   normalisation off the wet signal's loudness is predictable: a steady
//!   input comes out at about its own level, and the frontend's wet/dry mix
//!   (`reverbMix`) does the rest.
//! - Stereo = two calls with different seeds; independent noise decorrelates
//!   the channels, which is what makes a reverb sound wide.

use wasm_bindgen::prelude::*;

/// Pre-delay before the tail starts, seconds.
pub const PRE_DELAY_S: f64 = 0.008;
/// Longest IR we'll render, seconds.
pub const MAX_DURATION_S: f64 = 8.0;
const MIN_DURATION_S: f64 = 0.05;
const MIN_SAMPLE_RATE: f64 = 8_000.0;
const MAX_SAMPLE_RATE: f64 = 192_000.0;
/// Lowpass coefficient at the start of the tail (bright early reflections).
const BRIGHT: f64 = 0.9;
/// ln(1000): the envelope exponent that gives −60 dB at `duration`.
const LN_1000: f64 = 6.907_755_278_982_137;

fn finite_or(x: f64, fallback: f64) -> f64 {
    if x.is_finite() {
        x
    } else {
        fallback
    }
}

fn next_noise(state: &mut u32) -> f64 {
    let mut s = *state;
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    *state = s;
    (s as f64 / u32::MAX as f64) * 2.0 - 1.0
}

/// Render one channel of the impulse response. `duration` is the RT60 in
/// seconds (clamped to [0.05, 8]); `damping` in [0, 1] is how much darker the
/// end of the tail is than its start; `seed` picks the noise (use different
/// seeds per channel). Never empty, always finite.
pub fn impulse(sample_rate: f64, duration: f64, damping: f64, seed: u32) -> Vec<f32> {
    let sr = finite_or(sample_rate, 44_100.0).clamp(MIN_SAMPLE_RATE, MAX_SAMPLE_RATE);
    let duration = finite_or(duration, 2.0).clamp(MIN_DURATION_S, MAX_DURATION_S);
    let damping = finite_or(damping, 0.5).clamp(0.0, 1.0);
    let pre = (PRE_DELAY_S * sr).round() as usize;
    let tail = (duration * sr).round() as usize;
    let len = pre + tail;

    let mut seed = if seed == 0 { 0x2545_F491 } else { seed };
    let mut out = vec![0.0f64; len];
    let mut lp = 0.0f64;
    for (i, slot) in out.iter_mut().enumerate().skip(pre) {
        let frac = (i - pre) as f64 / tail as f64;
        let env = (-LN_1000 * frac).exp();
        let a = BRIGHT * (1.0 - damping * frac).max(0.02);
        lp += a * (next_noise(&mut seed) - lp);
        *slot = lp * env;
    }

    let energy: f64 = out.iter().map(|v| v * v).sum();
    let scale = if energy > 0.0 { 1.0 / energy.sqrt() } else { 0.0 };
    out.iter().map(|v| (v * scale) as f32).collect()
}

/// WASM export: one IR channel as a `Float32Array` for an `AudioBuffer`.
#[wasm_bindgen(js_name = reverbImpulse)]
pub fn reverb_impulse(sample_rate: f64, duration: f64, damping: f64, seed: u32) -> Vec<f32> {
    impulse(sample_rate, duration, damping, seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f64 = 44_100.0;

    fn energy(s: &[f32]) -> f64 {
        s.iter().map(|v| (*v as f64).powi(2)).sum()
    }

    /// First-difference energy over energy: a spectral-tilt (brightness) proxy.
    fn tilt(s: &[f32]) -> f64 {
        let d: f64 = s.windows(2).map(|w| ((w[1] - w[0]) as f64).powi(2)).sum();
        d / energy(s)
    }

    #[test]
    fn length_is_predelay_plus_tail() {
        let ir = impulse(SR, 2.0, 0.5, 1);
        let pre = (PRE_DELAY_S * SR).round() as usize;
        assert_eq!(ir.len(), pre + 88_200);
    }

    #[test]
    fn predelay_is_silent_and_tail_is_not() {
        let ir = impulse(SR, 1.5, 0.5, 3);
        let pre = (PRE_DELAY_S * SR).round() as usize;
        assert!(ir[..pre].iter().all(|v| *v == 0.0));
        assert!(energy(&ir[pre..pre + 441]) > 0.0);
    }

    #[test]
    fn has_unit_energy_and_is_finite() {
        for &d in &[0.3, 1.0, 2.5, 6.0] {
            let ir = impulse(SR, d, 0.5, 9);
            assert!(ir.iter().all(|v| v.is_finite()));
            assert!((energy(&ir) - 1.0).abs() < 1e-3, "duration {d}");
        }
    }

    #[test]
    fn decays_about_sixty_db_over_the_duration() {
        let ir = impulse(SR, 2.0, 0.0, 5);
        let pre = (PRE_DELAY_S * SR).round() as usize;
        let win = 2_205; // 50 ms
        let head = energy(&ir[pre..pre + win]);
        let mid_start = pre + 44_100 - win / 2; // t = 1 s ≈ −30 dB
        let mid = energy(&ir[mid_start..mid_start + win]);
        let drop_db = 10.0 * (mid / head).log10();
        assert!((-36.0..=-24.0).contains(&drop_db), "drop {drop_db:.1} dB");
    }

    #[test]
    fn tail_gets_darker_with_damping() {
        let ir = impulse(SR, 2.0, 0.9, 11);
        let pre = (PRE_DELAY_S * SR).round() as usize;
        let early = &ir[pre..pre + 8_000];
        let late = &ir[pre + 60_000..pre + 68_000];
        assert!(tilt(late) < tilt(early) * 0.5, "{} vs {}", tilt(late), tilt(early));
        // and with no damping the colour stays roughly constant
        let flat = impulse(SR, 2.0, 0.0, 11);
        let r = tilt(&flat[pre + 60_000..pre + 68_000]) / tilt(&flat[pre..pre + 8_000]);
        assert!((0.7..1.4).contains(&r), "ratio {r}");
    }

    #[test]
    fn deterministic_and_seeds_decorrelate_channels() {
        let l = impulse(SR, 1.0, 0.5, 1);
        assert_eq!(l, impulse(SR, 1.0, 0.5, 1));
        let r = impulse(SR, 1.0, 0.5, 2);
        assert_ne!(l, r);
        let dot: f64 = l.iter().zip(&r).map(|(a, b)| *a as f64 * *b as f64).sum();
        // both unit-energy, so the dot product is the correlation coefficient
        assert!(dot.abs() < 0.1, "correlation {dot}");
    }

    #[test]
    fn bad_parameters_are_sanitised() {
        let ir = impulse(f64::NAN, f64::NAN, f64::NAN, 0);
        assert!(!ir.is_empty());
        assert!(ir.iter().all(|v| v.is_finite()));
        let long = impulse(SR, 1e9, 2.0, 4);
        let pre = (PRE_DELAY_S * SR).round() as usize;
        assert_eq!(long.len(), pre + (MAX_DURATION_S * SR) as usize);
        let short = impulse(SR, -1.0, -1.0, 4);
        assert_eq!(short.len(), pre + (MIN_DURATION_S * SR).round() as usize);
    }

    #[test]
    fn wasm_export_matches_core() {
        assert_eq!(reverb_impulse(SR, 1.2, 0.4, 8), impulse(SR, 1.2, 0.4, 8));
    }
}
