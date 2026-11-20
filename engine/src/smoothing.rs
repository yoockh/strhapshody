//! One Euro filter smoothing (task 1.3).
//!
//! The One Euro filter (Casiez, Roussel & Vogel, CHI 2012) is an adaptive
//! low-pass filter designed for noisy, human-driven signals exactly like hand
//! landmark coordinates: at low speeds it filters hard to kill jitter, and at
//! high speeds it opens up to minimise lag. That speed/lag trade-off is tuned
//! by two parameters — `min_cutoff` (baseline smoothing at rest) and `beta`
//! (how aggressively the cutoff rises with speed).
//!
//! This module is pure, deterministic Rust (ADR-0002): a scalar filter the
//! frontend instantiates once per coordinate it wants smoothed (e.g. x, y of a
//! palm-centre landmark), feeding it the raw value plus a monotonically
//! increasing timestamp in **seconds**. No browser APIs, no camera — fully
//! `cargo test`-able with synthetic jittery input.

use std::f64::consts::PI;
use wasm_bindgen::prelude::*;

/// A single exponential low-pass filter: `y = a*x + (1-a)*y_prev`.
///
/// Kept separate (not just inlined) because the One Euro filter needs two of
/// them — one for the signal, one for its derivative — and because the first
/// sample must pass through untouched (there is no previous value to blend).
#[derive(Clone, Copy, Debug)]
struct LowPass {
    y: f64,
    initialized: bool,
}

impl LowPass {
    fn new() -> Self {
        LowPass {
            y: 0.0,
            initialized: false,
        }
    }

    /// Filter one sample with smoothing factor `alpha` in (0, 1]. The first
    /// ever sample is returned verbatim (seeds the filter state).
    fn filter(&mut self, x: f64, alpha: f64) -> f64 {
        let y = if self.initialized {
            alpha * x + (1.0 - alpha) * self.y
        } else {
            self.initialized = true;
            x
        };
        self.y = y;
        y
    }

    /// The last value this filter emitted. Only meaningful once initialized.
    fn last(&self) -> f64 {
        self.y
    }
}

/// Convert a cutoff frequency (Hz) and sampling period `te` (seconds) into the
/// exponential-smoothing factor alpha used by [`LowPass`].
///
/// `alpha = 1 / (1 + tau/te)` with `tau = 1 / (2*pi*cutoff)`. Higher cutoff or
/// longer period → alpha closer to 1 → less smoothing (trusts the new sample).
fn smoothing_alpha(cutoff: f64, te: f64) -> f64 {
    let tau = 1.0 / (2.0 * PI * cutoff);
    1.0 / (1.0 + tau / te)
}

/// Pure core of the One Euro filter, independent of wasm-bindgen so it can be
/// unit-tested and reused directly from native Rust. The wasm-exposed
/// [`OneEuroFilter`] is a thin wrapper around this.
#[derive(Clone, Copy, Debug)]
pub struct OneEuro {
    min_cutoff: f64,
    beta: f64,
    d_cutoff: f64,
    x_filter: LowPass,
    dx_filter: LowPass,
    last_time: f64,
    has_last_time: bool,
}

impl OneEuro {
    /// Create a filter.
    ///
    /// - `min_cutoff` (Hz, > 0): baseline cutoff; lower = smoother at rest.
    /// - `beta` (>= 0): speed coefficient; higher = less lag when moving fast.
    /// - `d_cutoff` (Hz, > 0): cutoff for the derivative low-pass; 1.0 is a
    ///   sensible default from the paper.
    ///
    /// Non-finite or non-positive cutoffs are clamped to small positive values,
    /// and a negative `beta` to 0, so a bad config can never produce NaN output
    /// or a divide-by-zero — important for an unattended build feeding it live
    /// landmark data.
    pub fn new(min_cutoff: f64, beta: f64, d_cutoff: f64) -> Self {
        OneEuro {
            min_cutoff: sanitize_positive(min_cutoff, 1.0),
            beta: if beta.is_finite() && beta >= 0.0 {
                beta
            } else {
                0.0
            },
            d_cutoff: sanitize_positive(d_cutoff, 1.0),
            x_filter: LowPass::new(),
            dx_filter: LowPass::new(),
            last_time: 0.0,
            has_last_time: false,
        }
    }

    /// Filter one sample `x` observed at `timestamp` (seconds).
    ///
    /// Timestamps must be non-decreasing. If a timestamp is not strictly
    /// greater than the previous one (duplicate, out-of-order, or the very
    /// first sample), the sampling rate can't be derived, so the sample is
    /// low-passed at `min_cutoff` with the stored period rather than dividing
    /// by zero — a graceful, jitter-free degradation.
    pub fn filter(&mut self, x: f64, timestamp: f64) -> f64 {
        if !x.is_finite() {
            // Never let a bad sample corrupt the filter state; echo the last
            // good output (or 0.0 before any good sample).
            return self.x_filter.last();
        }

        // Derive sampling period. Default to a nominal 60 Hz frame on the first
        // sample or whenever the timestamp doesn't advance.
        let te = if self.has_last_time && timestamp > self.last_time {
            timestamp - self.last_time
        } else {
            1.0 / 60.0
        };
        self.last_time = timestamp;
        self.has_last_time = true;

        // Estimate the derivative from the *filtered* signal (per the paper),
        // using the velocity in units/second.
        let dx = if self.x_filter.initialized {
            (x - self.x_filter.last()) / te
        } else {
            0.0
        };
        let edx = self
            .dx_filter
            .filter(dx, smoothing_alpha(self.d_cutoff, te));

        // Adapt the cutoff to the (filtered) speed, then low-pass the signal.
        let cutoff = self.min_cutoff + self.beta * edx.abs();
        self.x_filter.filter(x, smoothing_alpha(cutoff, te))
    }

    /// Reset the filter to its just-constructed state (e.g. when tracking is
    /// lost and the next sample should seed afresh rather than lag from a stale
    /// position). Config parameters are preserved.
    pub fn reset(&mut self) {
        self.x_filter = LowPass::new();
        self.dx_filter = LowPass::new();
        self.has_last_time = false;
        self.last_time = 0.0;
    }
}

fn sanitize_positive(v: f64, fallback: f64) -> f64 {
    if v.is_finite() && v > 0.0 {
        v
    } else {
        fallback
    }
}

/// WASM-exported One Euro filter. One instance smooths one scalar stream;
/// create several (e.g. per landmark coordinate) on the frontend side.
#[wasm_bindgen]
pub struct OneEuroFilter {
    inner: OneEuro,
}

#[wasm_bindgen]
impl OneEuroFilter {
    /// See [`OneEuro::new`]. Exposed to JS as `new OneEuroFilter(minCutoff, beta, dCutoff)`.
    #[wasm_bindgen(constructor)]
    pub fn new(min_cutoff: f64, beta: f64, d_cutoff: f64) -> OneEuroFilter {
        OneEuroFilter {
            inner: OneEuro::new(min_cutoff, beta, d_cutoff),
        }
    }

    /// Filter one sample observed at `timestamp` seconds. See [`OneEuro::filter`].
    pub fn filter(&mut self, x: f64, timestamp: f64) -> f64 {
        self.inner.filter(x, timestamp)
    }

    /// See [`OneEuro::reset`].
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic pseudo-random jitter in [-amp, amp], no `rand` dep.
    fn jitter(seed: &mut u64, amp: f64) -> f64 {
        // xorshift64
        let mut s = *seed;
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        *seed = s;
        // map to [-1, 1]
        let unit = (s as f64 / u64::MAX as f64) * 2.0 - 1.0;
        unit * amp
    }

    fn mean(xs: &[f64]) -> f64 {
        xs.iter().sum::<f64>() / xs.len() as f64
    }

    fn variance(xs: &[f64]) -> f64 {
        let m = mean(xs);
        xs.iter().map(|x| (x - m).powi(2)).sum::<f64>() / xs.len() as f64
    }

    #[test]
    fn first_sample_passes_through() {
        let mut f = OneEuro::new(1.0, 0.0, 1.0);
        // The first ever sample has no history, so it must be returned exactly.
        assert_eq!(f.filter(0.42, 0.0), 0.42);
    }

    #[test]
    fn constant_signal_converges_to_constant() {
        let mut f = OneEuro::new(1.0, 0.0, 1.0);
        let mut last = 0.0;
        for i in 0..100 {
            last = f.filter(5.0, i as f64 / 60.0);
        }
        // A perfectly steady input must settle at that value.
        assert!((last - 5.0).abs() < 1e-9, "settled at {last}, want 5.0");
    }

    #[test]
    fn reduces_variance_of_jittery_signal() {
        // Flat true signal (0.5) with noise; the filter must cut the variance.
        let mut f = OneEuro::new(1.0, 0.0, 1.0);
        let mut seed = 0x1234_5678_9abc_def0;
        let mut raw = Vec::new();
        let mut filtered = Vec::new();
        for i in 0..300 {
            let r = 0.5 + jitter(&mut seed, 0.05);
            raw.push(r);
            filtered.push(f.filter(r, i as f64 / 60.0));
        }
        // Discard the warm-up where the filter is still seeding.
        let raw_v = variance(&raw[50..]);
        let filt_v = variance(&filtered[50..]);
        assert!(
            filt_v < raw_v * 0.25,
            "filtered variance {filt_v} not < 25% of raw {raw_v}"
        );
    }

    #[test]
    fn tracks_a_ramp_without_runaway_lag() {
        // A steady ramp: the filtered output must track it closely (bounded
        // lag), not fall ever further behind. beta>0 keeps lag small on motion.
        let mut f = OneEuro::new(1.0, 0.7, 1.0);
        let dt = 1.0 / 60.0;
        let slope = 1.0; // units per second
        let mut max_lag_late = 0.0_f64;
        for i in 0..200 {
            let t = i as f64 * dt;
            let truth = slope * t;
            let out = f.filter(truth, t);
            if i > 100 {
                // After warm-up, lag should be small and bounded.
                max_lag_late = max_lag_late.max((truth - out).abs());
            }
        }
        assert!(
            max_lag_late < 0.05,
            "steady-state lag {max_lag_late} too large on a ramp"
        );
    }

    #[test]
    fn higher_beta_reduces_lag_on_fast_motion() {
        // Same fast ramp through two filters; the higher-beta one must lag less.
        let dt = 1.0 / 60.0;
        let slope = 5.0;
        let mut low = OneEuro::new(1.0, 0.0, 1.0);
        let mut high = OneEuro::new(1.0, 2.0, 1.0);
        let (mut low_out, mut high_out, mut truth) = (0.0, 0.0, 0.0);
        for i in 0..120 {
            let t = i as f64 * dt;
            truth = slope * t;
            low_out = low.filter(truth, t);
            high_out = high.filter(truth, t);
        }
        let low_lag = (truth - low_out).abs();
        let high_lag = (truth - high_out).abs();
        assert!(
            high_lag < low_lag,
            "high-beta lag {high_lag} should be < low-beta lag {low_lag}"
        );
    }

    #[test]
    fn non_increasing_timestamp_does_not_divide_by_zero() {
        let mut f = OneEuro::new(1.0, 1.0, 1.0);
        f.filter(0.0, 1.0);
        // Duplicate then earlier timestamps must not blow up (NaN/inf).
        let a = f.filter(1.0, 1.0);
        let b = f.filter(2.0, 0.5);
        assert!(a.is_finite(), "duplicate-timestamp output not finite: {a}");
        assert!(b.is_finite(), "backwards-timestamp output not finite: {b}");
    }

    #[test]
    fn non_finite_sample_is_ignored() {
        let mut f = OneEuro::new(1.0, 0.0, 1.0);
        let good = f.filter(3.0, 0.0);
        // Feed garbage; filter must echo last good value and stay finite.
        let nan_out = f.filter(f64::NAN, 0.1);
        let inf_out = f.filter(f64::INFINITY, 0.2);
        assert_eq!(nan_out, good);
        assert_eq!(inf_out, good);
        // And it must recover for the next good sample.
        let recovered = f.filter(3.0, 0.3);
        assert!((recovered - 3.0).abs() < 1e-9);
    }

    #[test]
    fn bad_config_is_sanitized_not_propagated() {
        // Zero/negative/NaN cutoffs and negative beta must not yield NaN output.
        let mut f = OneEuro::new(0.0, -1.0, f64::NAN);
        let mut out = 0.0;
        for i in 0..50 {
            out = f.filter(0.5 + (i as f64) * 0.001, i as f64 / 60.0);
        }
        assert!(out.is_finite(), "sanitized config still produced {out}");
    }

    #[test]
    fn reset_seeds_afresh_from_next_sample() {
        let mut f = OneEuro::new(1.0, 0.0, 1.0);
        for i in 0..50 {
            f.filter(0.0, i as f64 / 60.0);
        }
        f.reset();
        // After reset the next sample passes through verbatim (re-seeds).
        assert_eq!(f.filter(10.0, 100.0), 10.0);
    }

    #[test]
    fn smoothing_alpha_is_in_unit_range() {
        // Sanity on the alpha helper across a range of cutoffs/periods.
        for &cutoff in &[0.1, 1.0, 10.0, 100.0] {
            for &te in &[1.0 / 120.0, 1.0 / 60.0, 1.0 / 30.0] {
                let a = smoothing_alpha(cutoff, te);
                assert!(a > 0.0 && a <= 1.0, "alpha {a} out of (0,1] for cutoff {cutoff}, te {te}");
            }
        }
    }
}
