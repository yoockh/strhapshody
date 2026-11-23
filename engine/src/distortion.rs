//! Waveshaper distortion curve generator (task 5.2 / PRD §9).
//!
//! The electric guitar voice runs the summed string voices through a Web Audio
//! `WaveShaperNode`, whose `curve` is a lookup table mapping input sample
//! values in `[-1, 1]` (spread evenly across the table) to output values. This
//! module builds that table — the only part of the distortion that is logic
//! rather than audio plumbing, so it lives in the engine and is `cargo test`-ed
//! (ADR-0002); the frontend just assigns the returned `Float32Array`.
//!
//! ## Curve
//!
//! Normalised hyperbolic-tangent soft clipping:
//!
//! ```text
//! y = tanh(k·x) / tanh(k),   k = drive · MAX_K   (k → 0 ⇒ y = x)
//! ```
//!
//! - `drive = 0` is the identity — a *clean* electric tone through the same
//!   chain, no special-casing.
//! - Increasing drive raises the small-signal gain (`k / tanh k`) and squashes
//!   peaks towards ±1: classic overdrive → distortion as the knob turns.
//! - Odd-symmetric (`y(−x) = −y(x)`), so no DC offset and only odd harmonics —
//!   the warm "tube-ish" character rather than a fizzy asymmetric fuzz.
//! - Monotonic and bounded by ±1 with `y(±1) = ±1` exactly, so the output level
//!   is predictable and the frontend's level compensation is simple.
//!
//! An odd table length puts an entry exactly at `x = 0` (silence maps to
//! silence); the frontend uses 2049 entries.

use wasm_bindgen::prelude::*;

/// `k` at full drive. tanh(40·x) is effectively a hard clip with rounded
/// corners — heavy distortion without the harshness of a true square.
pub const MAX_K: f64 = 40.0;
/// Table length bounds (anything else is clamped).
pub const MIN_SAMPLES: usize = 2;
pub const MAX_SAMPLES: usize = 65_536;
/// Below this `k` the curve is numerically the identity; skip the division.
const LINEAR_K: f64 = 1e-6;

/// Shaper output for one input value `x ∈ [-1, 1]` at drive `drive ∈ [0, 1]`.
/// Out-of-range inputs are clamped (as the WaveShaperNode itself does).
pub fn shape(x: f64, drive: f64) -> f64 {
    let x = x.clamp(-1.0, 1.0);
    let k = sanitize_drive(drive) * MAX_K;
    if k < LINEAR_K {
        x
    } else {
        (k * x).tanh() / k.tanh()
    }
}

fn sanitize_drive(drive: f64) -> f64 {
    if drive.is_finite() {
        drive.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// Build a waveshaper table of `samples` entries spanning `x ∈ [-1, 1]`
/// inclusive, at the given drive. `samples` is clamped to
/// `[MIN_SAMPLES, MAX_SAMPLES]`; a non-finite drive is treated as 0 (clean).
pub fn curve(samples: usize, drive: f64) -> Vec<f32> {
    let n = samples.clamp(MIN_SAMPLES, MAX_SAMPLES);
    let last = (n - 1) as f64;
    (0..n)
        .map(|i| shape(i as f64 / last * 2.0 - 1.0, drive) as f32)
        .collect()
}

/// WASM export: a `Float32Array` ready for `WaveShaperNode.curve`.
#[wasm_bindgen(js_name = distortionCurve)]
pub fn distortion_curve(samples: u32, drive: f64) -> Vec<f32> {
    curve(samples as usize, drive)
}

#[cfg(test)]
mod tests {
    use super::*;

    const N: usize = 2049;

    #[test]
    fn length_is_honoured_and_clamped() {
        assert_eq!(curve(N, 0.5).len(), N);
        assert_eq!(curve(0, 0.5).len(), MIN_SAMPLES);
        assert_eq!(curve(1, 0.5).len(), MIN_SAMPLES);
        assert_eq!(curve(10_000_000, 0.5).len(), MAX_SAMPLES);
    }

    #[test]
    fn zero_drive_is_the_identity() {
        let c = curve(N, 0.0);
        for (i, y) in c.iter().enumerate() {
            let x = i as f64 / (N - 1) as f64 * 2.0 - 1.0;
            assert!((*y as f64 - x).abs() < 1e-6, "i={i} x={x} y={y}");
        }
    }

    #[test]
    fn endpoints_are_exactly_plus_minus_one_and_centre_is_silent() {
        for &d in &[0.0, 0.1, 0.5, 1.0] {
            let c = curve(N, d);
            assert!((c[0] + 1.0).abs() < 1e-6, "drive {d} start {}", c[0]);
            assert!((c[N - 1] - 1.0).abs() < 1e-6, "drive {d} end {}", c[N - 1]);
            assert!(c[N / 2].abs() < 1e-7, "drive {d} centre {}", c[N / 2]);
        }
    }

    #[test]
    fn odd_symmetric() {
        for &d in &[0.2, 0.7, 1.0] {
            let c = curve(N, d);
            for i in 0..N {
                assert!((c[i] + c[N - 1 - i]).abs() < 1e-6, "drive {d} i {i}");
            }
        }
    }

    #[test]
    fn monotonic_and_bounded() {
        for &d in &[0.0, 0.05, 0.3, 0.8, 1.0] {
            let c = curve(N, d);
            assert!(c.iter().all(|y| y.is_finite() && y.abs() <= 1.0 + 1e-6));
            assert!(c.windows(2).all(|w| w[1] >= w[0]), "drive {d} not monotonic");
        }
    }

    #[test]
    fn more_drive_means_more_gain_and_more_saturation() {
        // Small-signal gain at x = 0.05 rises with drive...
        let small = |d: f64| shape(0.05, d) / 0.05;
        assert!(small(0.25) > small(0.0));
        assert!(small(0.5) > small(0.25));
        assert!(small(1.0) > small(0.5));
        // ...and a mid-level input is pushed closer to the rail.
        let mid = |d: f64| shape(0.3, d);
        assert!(mid(1.0) > mid(0.5) && mid(0.5) > mid(0.1) && mid(0.1) > mid(0.0));
        assert!(mid(1.0) > 0.99);
    }

    #[test]
    fn heavy_drive_squares_up_a_sine() {
        // Crest factor (peak / RMS) of a shaped sine falls from √2 towards 1.
        let crest = |d: f64| {
            let n = 1000;
            let ys: Vec<f64> = (0..n)
                .map(|i| shape((i as f64 / n as f64 * std::f64::consts::TAU).sin(), d))
                .collect();
            let peak = ys.iter().fold(0.0f64, |m, y| m.max(y.abs()));
            let rms = (ys.iter().map(|y| y * y).sum::<f64>() / n as f64).sqrt();
            peak / rms
        };
        assert!((crest(0.0) - std::f64::consts::SQRT_2).abs() < 1e-3);
        assert!(crest(1.0) < 1.1);
        assert!(crest(0.5) < crest(0.1));
    }

    #[test]
    fn out_of_range_and_bad_drive_are_sanitised() {
        assert_eq!(shape(5.0, 0.5), shape(1.0, 0.5));
        assert_eq!(shape(-5.0, 0.5), shape(-1.0, 0.5));
        assert_eq!(shape(0.3, f64::NAN), 0.3);
        assert_eq!(shape(0.3, -2.0), 0.3);
        assert_eq!(shape(0.3, 7.0), shape(0.3, 1.0));
        assert!(curve(N, f64::INFINITY).iter().all(|y| y.is_finite()));
    }

    #[test]
    fn wasm_export_matches_core() {
        assert_eq!(distortion_curve(N as u32, 0.6), curve(N, 0.6));
    }
}
