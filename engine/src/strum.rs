//! Strum detection (task 2.2 / PRD §8).
//!
//! The right hand tracks as a single point (fingertip or palm). As that point
//! moves vertically across the six virtual string lines, each line it crosses
//! should fire the moment it is crossed — that staggered firing is what gives a
//! real strum its "rake". This module turns a stream of `(y, timestamp)` samples
//! of that point into discrete strum events:
//!
//! - **which** string lines were crossed on this step (possibly several at once
//!   if the hand moved fast — a "double-cross in one frame"),
//! - the **direction** (down = increasing y on screen → strings sound top to
//!   bottom; up = decreasing y → bottom to top, per PRD §8), and
//! - the **velocity** of the hand (px/second) at the crossing, which the audio
//!   layer later maps to loudness / strum spread.
//!
//! Pure, deterministic Rust (ADR-0002): no camera, no audio, no browser APIs.
//! It is fed the already-computed string y positions (`strings.ts`
//! `computeStringYs`) and the hand point's smoothed y. Fully `cargo test`-able
//! with synthetic up/down/slow/fast trajectories.
//!
//! ## Crossing convention
//!
//! A string line at `s` is crossed on a step from `last_y` to `y` iff `s` lies
//! between them, using a **half-open** interval so that a hand coming to rest
//! exactly on a line, or re-crossing from exactly that line, never double-fires
//! the same string:
//!
//! - moving **down** (`y > last_y`): crossed iff `last_y < s <= y`
//! - moving **up**   (`y < last_y`): crossed iff `y <= s < last_y`
//!
//! Lines are reported in the order the hand encounters them (top→bottom on a
//! downstroke, bottom→top on an upstroke), so the caller can trigger the voices
//! in rake order directly.

use wasm_bindgen::prelude::*;

/// Direction of a strum across the string lines.
///
/// `Down` = the hand moved in the +y (downward on screen) direction, sounding
/// strings top to bottom. `Up` = -y, sounding bottom to top. (PRD §8.)
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StrumDirection {
    Down,
    Up,
}

/// A single string-line crossing produced by [`StrumCore::push`].
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct StrumEvent {
    string_index: u32,
    direction: StrumDirection,
    velocity: f64,
}

#[wasm_bindgen]
impl StrumEvent {
    /// Index of the crossed string, `0 == topmost` line (lowest-pitched string
    /// per `strings.ts`: index 0 = low E at the top).
    #[wasm_bindgen(getter)]
    pub fn string_index(&self) -> u32 {
        self.string_index
    }

    /// Direction of the hand motion that produced this crossing.
    #[wasm_bindgen(getter)]
    pub fn direction(&self) -> StrumDirection {
        self.direction
    }

    /// Hand speed at the crossing, in px/second (always >= 0, always finite).
    #[wasm_bindgen(getter)]
    pub fn velocity(&self) -> f64 {
        self.velocity
    }
}

/// Pure core of the strum detector, independent of wasm-bindgen so it can be
/// unit-tested and reused directly from native Rust. The wasm-exposed
/// [`StrumDetector`] is a thin wrapper around this.
#[derive(Clone, Debug)]
pub struct StrumCore {
    /// String line y positions, sorted ascending (top → bottom). Index into
    /// this vec is the reported `string_index`.
    strings: Vec<f64>,
    last_y: f64,
    last_time: f64,
    has_last: bool,
    /// Crossings on a step slower than this (px/s) are not reported — the
    /// user-tunable "strum threshold" (task 6.2). 0 = report every crossing.
    min_velocity: f64,
}

/// Nominal frame period (seconds) used for velocity when a real one can't be
/// derived (first sample, duplicate/backwards timestamp): ~60 Hz.
const NOMINAL_PERIOD: f64 = 1.0 / 60.0;

impl StrumCore {
    /// Create a detector for the given string line y positions. Non-finite
    /// positions are dropped; the rest are sorted ascending (top→bottom) so the
    /// reported `string_index` is stable regardless of input order.
    pub fn new(strings: &[f64]) -> Self {
        let mut strings: Vec<f64> = strings.iter().copied().filter(|v| v.is_finite()).collect();
        strings.sort_by(|a, b| a.partial_cmp(b).unwrap());
        StrumCore {
            strings,
            last_y: 0.0,
            last_time: 0.0,
            has_last: false,
            min_velocity: 0.0,
        }
    }

    /// Set the strum threshold: steps slower than `min_velocity` px/s produce
    /// no events (a slow drift across a line doesn't pluck it). The reference
    /// point still advances on such steps, so a line passed slowly is simply
    /// skipped — it never fires late. Non-finite or negative → 0 (off).
    pub fn set_min_velocity(&mut self, min_velocity: f64) {
        self.min_velocity = if min_velocity.is_finite() && min_velocity > 0.0 {
            min_velocity
        } else {
            0.0
        };
    }

    /// The current strum threshold in px/s.
    pub fn min_velocity(&self) -> f64 {
        self.min_velocity
    }

    /// Feed the next hand-point sample `(y, timestamp)` (y in px, timestamp in
    /// seconds) and return every string crossed since the previous sample, in
    /// rake order (the order the hand passed them).
    ///
    /// Returns empty on the first sample (nothing to cross from), on a
    /// non-finite `y` (ignored, state preserved), and whenever the hand did not
    /// move across any line.
    pub fn push(&mut self, y: f64, timestamp: f64) -> Vec<StrumEvent> {
        if !y.is_finite() {
            // Garbage sample: ignore it entirely, keep the last good state so the
            // next good sample measures crossings from where we really were.
            return Vec::new();
        }

        if !self.has_last {
            self.last_y = y;
            self.last_time = timestamp;
            self.has_last = true;
            return Vec::new();
        }

        let prev_y = self.last_y;
        let prev_t = self.last_time;
        // Advance state before any early return so a no-crossing step still
        // updates the reference point.
        self.last_y = y;
        self.last_time = timestamp;

        if y == prev_y {
            // No vertical motion → no crossings (also avoids a 0-direction).
            return Vec::new();
        }

        // Velocity: px/second. Fall back to a nominal frame when the timestamp
        // did not advance (duplicate/backwards) so we never divide by zero.
        let dt = if timestamp.is_finite() && timestamp > prev_t {
            timestamp - prev_t
        } else {
            NOMINAL_PERIOD
        };
        let velocity = ((y - prev_y).abs() / dt).abs();
        if velocity < self.min_velocity {
            // Too slow to count as a strum (state already advanced above).
            return Vec::new();
        }

        let direction = if y > prev_y {
            StrumDirection::Down
        } else {
            StrumDirection::Up
        };

        let mut events = Vec::new();
        match direction {
            StrumDirection::Down => {
                // Top → bottom: iterate strings ascending; crossed iff prev < s <= y.
                for (i, &s) in self.strings.iter().enumerate() {
                    if prev_y < s && s <= y {
                        events.push(StrumEvent {
                            string_index: i as u32,
                            direction,
                            velocity,
                        });
                    }
                }
            }
            StrumDirection::Up => {
                // Bottom → top: iterate strings descending; crossed iff y <= s < prev.
                for (i, &s) in self.strings.iter().enumerate().rev() {
                    if y <= s && s < prev_y {
                        events.push(StrumEvent {
                            string_index: i as u32,
                            direction,
                            velocity,
                        });
                    }
                }
            }
        }
        events
    }

    /// Reset to the just-constructed state (string positions preserved) so the
    /// next sample re-seeds the reference point. Call when tracking is lost or
    /// the hand leaves the strum zone, so a large jump back in doesn't register
    /// as one giant strum across every string.
    pub fn reset(&mut self) {
        self.has_last = false;
        self.last_y = 0.0;
        self.last_time = 0.0;
    }
}

/// WASM-exported strum detector. One instance tracks one hand point against a
/// fixed set of string lines.
#[wasm_bindgen]
pub struct StrumDetector {
    inner: StrumCore,
}

#[wasm_bindgen]
impl StrumDetector {
    /// See [`StrumCore::new`]. Exposed to JS as `new StrumDetector(stringYs)`,
    /// where `stringYs` is a `Float64Array` of the six string line y positions.
    #[wasm_bindgen(constructor)]
    pub fn new(strings: &[f64]) -> StrumDetector {
        StrumDetector {
            inner: StrumCore::new(strings),
        }
    }

    /// See [`StrumCore::push`]. Returns the crossings for this sample in rake
    /// order (JS receives an array of `StrumEvent`).
    pub fn push(&mut self, y: f64, timestamp: f64) -> Vec<StrumEvent> {
        self.inner.push(y, timestamp)
    }

    /// See [`StrumCore::reset`].
    pub fn reset(&mut self) {
        self.inner.reset();
    }

    /// See [`StrumCore::set_min_velocity`] (px/s; 0 = off).
    #[wasm_bindgen(js_name = setMinVelocity)]
    pub fn set_min_velocity(&mut self, min_velocity: f64) {
        self.inner.set_min_velocity(min_velocity);
    }

    /// See [`StrumCore::min_velocity`].
    #[wasm_bindgen(getter, js_name = minVelocity)]
    pub fn min_velocity(&self) -> f64 {
        self.inner.min_velocity()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The six string lines used across the tests: evenly spaced, top→bottom.
    fn strings() -> Vec<f64> {
        vec![100.0, 140.0, 180.0, 220.0, 260.0, 300.0]
    }

    fn indices(events: &[StrumEvent]) -> Vec<u32> {
        events.iter().map(|e| e.string_index).collect()
    }

    #[test]
    fn first_sample_never_fires() {
        let mut d = StrumCore::new(&strings());
        // Nothing to cross from on the very first sample, even if it lands on a line.
        assert!(d.push(100.0, 0.0).is_empty());
    }

    #[test]
    fn downstroke_crosses_all_strings_top_to_bottom() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0); // seed above the top string
        let ev = d.push(350.0, 0.1); // sweep below the bottom string
        // All six, in top→bottom rake order.
        assert_eq!(indices(&ev), vec![0, 1, 2, 3, 4, 5]);
        assert!(ev.iter().all(|e| e.direction == StrumDirection::Down));
    }

    #[test]
    fn upstroke_crosses_all_strings_bottom_to_top() {
        let mut d = StrumCore::new(&strings());
        d.push(350.0, 0.0); // seed below the bottom string
        let ev = d.push(50.0, 0.1); // sweep up past the top string
        // All six, in bottom→top rake order.
        assert_eq!(indices(&ev), vec![5, 4, 3, 2, 1, 0]);
        assert!(ev.iter().all(|e| e.direction == StrumDirection::Up));
    }

    #[test]
    fn partial_downstroke_only_fires_crossed_strings() {
        let mut d = StrumCore::new(&strings());
        d.push(150.0, 0.0); // between strings 1 (140) and 2 (180)
        let ev = d.push(230.0, 0.05); // crosses 180 and 220, not 260
        assert_eq!(indices(&ev), vec![2, 3]);
    }

    #[test]
    fn near_miss_approaching_a_line_does_not_fire() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0);
        // Moves down but stops just above the first line (100).
        let ev = d.push(99.9, 0.05);
        assert!(ev.is_empty(), "approaching without crossing must not fire: {ev:?}");
    }

    #[test]
    fn near_miss_wobble_between_two_lines_does_not_fire() {
        let mut d = StrumCore::new(&strings());
        d.push(150.0, 0.0); // sits between lines 1 and 2
        // Jitters around without ever reaching 140 or 180.
        assert!(d.push(160.0, 0.02).is_empty());
        assert!(d.push(145.0, 0.04).is_empty());
        assert!(d.push(155.0, 0.06).is_empty());
    }

    #[test]
    fn double_cross_in_one_frame_fires_both() {
        let mut d = StrumCore::new(&strings());
        d.push(130.0, 0.0); // between line 0 (100) and line 1 (140)
        // One fast frame step jumps across two lines (140 and 180) at once.
        let ev = d.push(190.0, 0.016);
        assert_eq!(indices(&ev), vec![1, 2]);
    }

    #[test]
    fn landing_exactly_on_a_line_fires_once_then_resting_does_not_refire() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0);
        // Down onto line 0 exactly: half-open (prev, y] includes it → fires.
        let a = d.push(100.0, 0.05);
        assert_eq!(indices(&a), vec![0]);
        // Hand rests exactly on the line: no motion, no re-fire.
        let b = d.push(100.0, 0.10);
        assert!(b.is_empty());
        // Nudges back up off the line: [y, prev) excludes prev==100 → no re-fire.
        let c = d.push(80.0, 0.15);
        assert!(c.is_empty(), "leaving a line must not re-fire it: {c:?}");
    }

    #[test]
    fn down_then_up_across_same_line_fires_each_direction_once() {
        let mut d = StrumCore::new(&strings());
        d.push(90.0, 0.0);
        let down = d.push(110.0, 0.05); // cross line 0 going down
        assert_eq!(indices(&down), vec![0]);
        assert_eq!(down[0].direction, StrumDirection::Down);
        let up = d.push(90.0, 0.10); // cross line 0 going back up
        assert_eq!(indices(&up), vec![0]);
        assert_eq!(up[0].direction, StrumDirection::Up);
    }

    #[test]
    fn faster_strum_reports_higher_velocity() {
        let mut slow = StrumCore::new(&strings());
        slow.push(50.0, 0.0);
        let slow_ev = slow.push(350.0, 0.3); // 300px over 0.3s = 1000 px/s

        let mut fast = StrumCore::new(&strings());
        fast.push(50.0, 0.0);
        let fast_ev = fast.push(350.0, 0.05); // 300px over 0.05s = 6000 px/s

        let slow_v = slow_ev[0].velocity;
        let fast_v = fast_ev[0].velocity;
        assert!(fast_v > slow_v, "fast {fast_v} should exceed slow {slow_v}");
        assert!((slow_v - 1000.0).abs() < 1e-6, "slow velocity {slow_v} != 1000");
        assert!((fast_v - 6000.0).abs() < 1e-6, "fast velocity {fast_v} != 6000");
    }

    #[test]
    fn velocity_is_always_finite_and_non_negative() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0);
        // Duplicate timestamp: dt falls back to the nominal frame, no div-by-zero.
        let ev = d.push(350.0, 0.0);
        assert_eq!(indices(&ev), vec![0, 1, 2, 3, 4, 5]);
        for e in &ev {
            assert!(e.velocity.is_finite() && e.velocity >= 0.0, "bad velocity {}", e.velocity);
        }
        // 300px over the nominal 1/60s ~= 18000 px/s.
        assert!((ev[0].velocity - 300.0 * 60.0).abs() < 1e-6);
    }

    #[test]
    fn backwards_timestamp_still_detects_crossing_without_blowing_up() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 1.0);
        let ev = d.push(200.0, 0.5); // earlier timestamp than previous
        // Crossings still detected (0,1,2); velocity uses nominal fallback, finite.
        assert_eq!(indices(&ev), vec![0, 1, 2]);
        assert!(ev.iter().all(|e| e.velocity.is_finite() && e.velocity >= 0.0));
    }

    #[test]
    fn non_finite_sample_is_ignored_and_state_preserved() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0);
        // NaN/inf must not move the reference point or fire anything.
        assert!(d.push(f64::NAN, 0.05).is_empty());
        assert!(d.push(f64::INFINITY, 0.10).is_empty());
        // The next good sample crosses from the original 50, not from garbage.
        let ev = d.push(350.0, 0.15);
        assert_eq!(indices(&ev), vec![0, 1, 2, 3, 4, 5]);
    }

    #[test]
    fn reset_prevents_a_phantom_strum_across_a_jump() {
        let mut d = StrumCore::new(&strings());
        d.push(50.0, 0.0);
        d.push(120.0, 0.05); // fires line 0
        d.reset();
        // After reset, a big jump back in re-seeds instead of raking every line.
        let ev = d.push(350.0, 0.10);
        assert!(ev.is_empty(), "reset should swallow the next sample, got {ev:?}");
        // And detection resumes normally afterward.
        let ev2 = d.push(300.0, 0.15);
        assert_eq!(indices(&ev2), vec![5]); // only line at 300 is <= 350 going up
    }

    #[test]
    fn unsorted_or_nonfinite_string_input_is_normalized() {
        // Caller passes lines out of order with a NaN; detector sorts & drops it.
        let mut d = StrumCore::new(&[180.0, f64::NAN, 100.0, 140.0]);
        d.push(50.0, 0.0);
        let ev = d.push(200.0, 0.05);
        // Sorted ascending => [100,140,180]; all crossed, top→bottom.
        assert_eq!(indices(&ev), vec![0, 1, 2]);
    }

    #[test]
    fn no_strings_configured_never_fires() {
        let mut d = StrumCore::new(&[]);
        d.push(0.0, 0.0);
        assert!(d.push(1000.0, 0.1).is_empty());
    }

    // --- strum threshold (task 6.2) -------------------------------------

    #[test]
    fn threshold_off_by_default() {
        let d = StrumCore::new(&strings());
        assert_eq!(d.min_velocity(), 0.0);
    }

    #[test]
    fn slow_crossing_below_threshold_is_ignored_fast_one_fires() {
        let s = strings();
        let mut d = StrumCore::new(&s);
        d.set_min_velocity(500.0);
        // 10 px in 0.1 s = 100 px/s across the first line: ignored.
        d.push(s[0] - 5.0, 0.0);
        assert!(d.push(s[0] + 5.0, 0.1).is_empty());
        // A fast pass over the next line (6000 px/s) fires.
        let ev = d.push(s[1] + 5.0, 0.1 + (s[1] - s[0]) / 6000.0);
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].string_index, 1);
    }

    #[test]
    fn slowly_passed_line_never_fires_late() {
        let s = strings();
        let mut d = StrumCore::new(&s);
        d.set_min_velocity(500.0);
        d.push(s[0] - 5.0, 0.0);
        d.push(s[0] + 5.0, 0.1); // slow pass over line 0 (ignored)
        // Now move fast but without reaching line 1: nothing (line 0 is behind us).
        assert!(d.push(s[0] + 10.0, 0.101).is_empty());
    }

    #[test]
    fn threshold_sanitised() {
        let mut d = StrumCore::new(&strings());
        d.set_min_velocity(f64::NAN);
        assert_eq!(d.min_velocity(), 0.0);
        d.set_min_velocity(-3.0);
        assert_eq!(d.min_velocity(), 0.0);
        d.set_min_velocity(250.0);
        assert_eq!(d.min_velocity(), 250.0);
    }

    #[test]
    fn threshold_exactly_equal_still_fires() {
        let s = strings();
        let mut d = StrumCore::new(&s);
        d.set_min_velocity(1000.0);
        d.push(s[0] - 5.0, 0.0);
        let ev = d.push(s[0] + 5.0, 0.01); // 10 px / 0.01 s = 1000 px/s
        assert_eq!(ev.len(), 1);
    }
}
