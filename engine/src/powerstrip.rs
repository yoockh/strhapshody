//! Power chord strip geometry (task 4.1 / PRD §7).
//!
//! A power chord is just the **root and fifth** (two strings, optionally the
//! octave), so it bypasses the hex map. Instead the left hand hovers a dedicated
//! horizontal **strip** at the top of the left zone, where:
//!
//! - **horizontal position selects the fret** (0..12, shown as fret markers —
//!   moving right raises the pitch), and
//! - **height within the strip selects the string pair**:
//!   - upper half → root on the lowest-pitched string (6th / low E), fifth on
//!     the 5th string (A), optional octave on the 4th string (D);
//!   - lower half → root on the 5th string (A), fifth on the 4th string (D),
//!     optional octave on the 3rd string (G).
//!
//! This module owns *only* that pure strip geometry — fret-from-x and
//! string-pair-from-y — plus the fret-marker x positions the renderer (task 4.2)
//! needs. It deliberately does **not** compute note names ("G5 (fret 3, low E)",
//! PRD §7 display): that is note math, which lives in TypeScript alongside the
//! other note-name code (`notes.ts` / `chords.ts`), task 4.3. Here we emit the
//! fret number and the affected string indices and nothing else.
//!
//! Pure, deterministic Rust (ADR-0002): no camera, no audio, no browser APIs.
//! It is fed the strip rectangle (canvas pixels) and the left hand's smoothed
//! palm-centre cursor (mapped through the same cover-crop+mirror transform the
//! overlay / hex cursor use), and is fully `cargo test`-able with synthetic
//! cursor positions.
//!
//! ## Fret mapping
//!
//! The strip spans `max_fret + 1` equal-width cells (13 cells for frets 0..12).
//! A cursor at x maps to `fret = floor((x - left) / cell_width)`, clamped into
//! `0..=max_fret`; a cursor outside the strip's horizontal span is "no fret"
//! (`None`). `fret_marker_x(fret)` returns the centre x of a cell for the UI.
//!
//! ## String-pair mapping
//!
//! Split the strip's height at its midline: a cursor in the upper half selects
//! the 6th+5th pair, the lower half the 5th+4th pair. String indices follow
//! `strings.ts`: 0 = low E (6th, top) … 5 = high e (1st, bottom).

use wasm_bindgen::prelude::*;

/// The default highest selectable fret (PRD §7: "0 to 12").
pub const DEFAULT_MAX_FRET: u32 = 12;

/// Which string pair the strip's height selects.
///
/// `Upper` = the 6th+5th strings (root on low E); `Lower` = the 5th+4th strings
/// (root on A). Per PRD §7.
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PowerPair {
    Upper,
    Lower,
}

impl PowerPair {
    /// String index (per `strings.ts`, 0 = low E) the **root** sounds on.
    pub fn root_string(self) -> u32 {
        match self {
            PowerPair::Upper => 0, // 6th / low E
            PowerPair::Lower => 1, // 5th / A
        }
    }

    /// String index the **fifth** sounds on (one string below the root).
    pub fn fifth_string(self) -> u32 {
        self.root_string() + 1
    }

    /// String index the **optional octave** sounds on (two strings below the
    /// root — the standard E-shape / A-shape power-chord octave).
    pub fn octave_string(self) -> u32 {
        self.root_string() + 2
    }
}

/// Pure (wasm-free) power-strip geometry. Holds the strip rectangle and fret
/// count; every query is stateless. See the module docs for the mapping.
#[derive(Clone, Debug)]
pub struct PowerStripCore {
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
    /// Highest selectable fret; there are `max_fret + 1` cells.
    max_fret: u32,
}

impl PowerStripCore {
    /// Build a strip spanning the rectangle `[left,right] × [top,bottom]` (canvas
    /// pixels) with frets `0..=max_fret`. Edges are normalised so `left < right`
    /// and `top < bottom` regardless of argument order; a degenerate (zero-width
    /// or zero-height) or non-finite rectangle is floored to a tiny positive
    /// extent so no query divides by zero. `max_fret` is floored to at least 1.
    pub fn new(left: f64, top: f64, right: f64, bottom: f64, max_fret: u32) -> Self {
        let (left, right) = normalise_span(left, right);
        let (top, bottom) = normalise_span(top, bottom);
        let max_fret = max_fret.max(1);
        Self {
            left,
            top,
            right,
            bottom,
            max_fret,
        }
    }

    /// Highest selectable fret.
    pub fn max_fret(&self) -> u32 {
        self.max_fret
    }

    /// Number of fret cells (`max_fret + 1`).
    pub fn fret_count(&self) -> u32 {
        self.max_fret + 1
    }

    /// Strip rectangle as `(left, top, right, bottom)`.
    pub fn rect(&self) -> (f64, f64, f64, f64) {
        (self.left, self.top, self.right, self.bottom)
    }

    /// Width of one fret cell in pixels.
    fn cell_width(&self) -> f64 {
        (self.right - self.left) / self.fret_count() as f64
    }

    /// `true` iff `(px, py)` is inside the strip rectangle.
    pub fn contains(&self, px: f64, py: f64) -> bool {
        px.is_finite()
            && py.is_finite()
            && px >= self.left
            && px <= self.right
            && py >= self.top
            && py <= self.bottom
    }

    /// Fret a cursor x selects, or `None` if x is outside the strip's horizontal
    /// span (or non-finite). Result is always within `0..=max_fret`.
    pub fn fret_at_x(&self, px: f64) -> Option<u32> {
        if !px.is_finite() || px < self.left || px > self.right {
            return None;
        }
        let raw = ((px - self.left) / self.cell_width()).floor();
        // `px == right` lands on cell `fret_count`, which is out of range by one;
        // clamp both ends so the inclusive right edge reads as the top fret.
        let fret = (raw as i64).clamp(0, self.max_fret as i64);
        Some(fret as u32)
    }

    /// String pair a cursor y selects, or `None` if y is outside the strip's
    /// vertical span (or non-finite). Upper half → `Upper`, lower half → `Lower`;
    /// the exact midline counts as the upper half.
    pub fn pair_at_y(&self, py: f64) -> Option<PowerPair> {
        if !py.is_finite() || py < self.top || py > self.bottom {
            return None;
        }
        let mid = 0.5 * (self.top + self.bottom);
        if py <= mid {
            Some(PowerPair::Upper)
        } else {
            Some(PowerPair::Lower)
        }
    }

    /// Centre x (canvas pixels) of fret cell `fret`, for drawing fret markers.
    /// A `fret` above `max_fret` is clamped to the last cell.
    pub fn fret_marker_x(&self, fret: u32) -> f64 {
        let fret = fret.min(self.max_fret);
        self.left + (fret as f64 + 0.5) * self.cell_width()
    }
}

/// Normalise a 1-D span so the returned `(lo, hi)` has `lo < hi`, flooring a
/// degenerate or non-finite span to a tiny positive extent.
fn normalise_span(a: f64, b: f64) -> (f64, f64) {
    let a = if a.is_finite() { a } else { 0.0 };
    let b = if b.is_finite() { b } else { 0.0 };
    let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
    if hi - lo > 1e-9 {
        (lo, hi)
    } else {
        (lo, lo + 1e-6)
    }
}

/// Thin `#[wasm_bindgen]` wrapper over [`PowerStripCore`] (ADR-0002 split).
///
/// Fret results cross the boundary as `i32` with `-1` meaning "cursor not over
/// the strip horizontally" (no Option shim in TS); the string pair crosses as
/// `i32` with `-1` = "not over the strip vertically", `0` = upper, `1` = lower.
#[wasm_bindgen]
pub struct PowerStrip {
    core: PowerStripCore,
}

#[wasm_bindgen]
impl PowerStrip {
    /// `new PowerStrip(left, top, right, bottom, maxFret)` — see
    /// [`PowerStripCore::new`].
    #[wasm_bindgen(constructor)]
    pub fn new(left: f64, top: f64, right: f64, bottom: f64, max_fret: u32) -> PowerStrip {
        PowerStrip {
            core: PowerStripCore::new(left, top, right, bottom, max_fret),
        }
    }

    /// `true` iff `(px, py)` is inside the strip rectangle (used to decide
    /// Power vs. Chord mode, task 4.2).
    pub fn contains(&self, px: f64, py: f64) -> bool {
        self.core.contains(px, py)
    }

    /// Fret a cursor x selects (`0..=maxFret`), or `-1` if x is off the strip.
    #[wasm_bindgen(js_name = fretAtX)]
    pub fn fret_at_x(&self, px: f64) -> i32 {
        match self.core.fret_at_x(px) {
            Some(f) => f as i32,
            None => -1,
        }
    }

    /// String pair a cursor y selects: `0` = upper (6th+5th), `1` = lower
    /// (5th+4th), `-1` if y is off the strip.
    #[wasm_bindgen(js_name = pairAtY)]
    pub fn pair_at_y(&self, py: f64) -> i32 {
        match self.core.pair_at_y(py) {
            Some(PowerPair::Upper) => 0,
            Some(PowerPair::Lower) => 1,
            None => -1,
        }
    }

    /// Centre x of fret cell `fret` in canvas pixels (fret clamped to `maxFret`).
    #[wasm_bindgen(js_name = fretMarkerX)]
    pub fn fret_marker_x(&self, fret: u32) -> f64 {
        self.core.fret_marker_x(fret)
    }

    /// Highest selectable fret.
    #[wasm_bindgen(js_name = maxFret)]
    pub fn max_fret(&self) -> u32 {
        self.core.max_fret()
    }

    /// Number of fret cells (`maxFret + 1`).
    #[wasm_bindgen(js_name = fretCount)]
    pub fn fret_count(&self) -> u32 {
        self.core.fret_count()
    }

    /// Root string index for a pair (`0` = upper → low E, `1` = lower → A);
    /// `-1` for an invalid pair index.
    #[wasm_bindgen(js_name = rootString)]
    pub fn root_string(&self, pair: i32) -> i32 {
        pair_from_i32(pair).map_or(-1, |p| p.root_string() as i32)
    }

    /// Fifth string index for a pair; `-1` for an invalid pair index.
    #[wasm_bindgen(js_name = fifthString)]
    pub fn fifth_string(&self, pair: i32) -> i32 {
        pair_from_i32(pair).map_or(-1, |p| p.fifth_string() as i32)
    }

    /// Optional octave string index for a pair; `-1` for an invalid pair index.
    #[wasm_bindgen(js_name = octaveString)]
    pub fn octave_string(&self, pair: i32) -> i32 {
        pair_from_i32(pair).map_or(-1, |p| p.octave_string() as i32)
    }
}

/// Decode the `0`/`1` boundary encoding of [`PowerPair`].
fn pair_from_i32(pair: i32) -> Option<PowerPair> {
    match pair {
        0 => Some(PowerPair::Upper),
        1 => Some(PowerPair::Lower),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A strip 130px wide (so each of the 13 frets is exactly 10px) and 40px tall,
    // offset away from the origin to catch any (left,top) mistakes.
    fn strip() -> PowerStripCore {
        PowerStripCore::new(200.0, 50.0, 330.0, 90.0, DEFAULT_MAX_FRET)
    }

    #[test]
    fn fret_count_is_max_plus_one() {
        let s = strip();
        assert_eq!(s.max_fret(), 12);
        assert_eq!(s.fret_count(), 13);
    }

    #[test]
    fn fret_at_left_edge_is_zero() {
        let s = strip();
        assert_eq!(s.fret_at_x(200.0), Some(0));
        assert_eq!(s.fret_at_x(205.0), Some(0)); // still inside cell 0
    }

    #[test]
    fn fret_at_right_edge_is_max() {
        let s = strip();
        // Exactly the right edge clamps to the top fret rather than overflowing.
        assert_eq!(s.fret_at_x(330.0), Some(12));
        // Just inside the last cell.
        assert_eq!(s.fret_at_x(329.0), Some(12));
    }

    #[test]
    fn fret_steps_across_the_strip() {
        let s = strip();
        // 10px cells: fret f occupies [200 + 10f, 200 + 10(f+1)). Sample mid-cell.
        for f in 0..=12u32 {
            let x = 200.0 + 10.0 * f as f64 + 5.0;
            assert_eq!(s.fret_at_x(x), Some(f), "mid of fret {f}");
        }
    }

    #[test]
    fn fret_outside_horizontal_span_is_none() {
        let s = strip();
        assert_eq!(s.fret_at_x(199.0), None); // left of the strip
        assert_eq!(s.fret_at_x(331.0), None); // right of the strip
        assert_eq!(s.fret_at_x(f64::NAN), None);
    }

    #[test]
    fn fret_moving_right_raises_pitch() {
        // PRD §7: "Moving right raises the pitch." Frets must be monotonic in x.
        let s = strip();
        let mut last = -1i64;
        let mut x = 200.0;
        while x <= 330.0 {
            let f = s.fret_at_x(x).unwrap() as i64;
            assert!(f >= last, "fret must not decrease as x increases");
            last = f;
            x += 1.0;
        }
        assert_eq!(last, 12);
    }

    #[test]
    fn pair_upper_half_is_6th_5th() {
        let s = strip();
        // Top of the strip and just above the midline → Upper.
        assert_eq!(s.pair_at_y(50.0), Some(PowerPair::Upper));
        assert_eq!(s.pair_at_y(69.0), Some(PowerPair::Upper));
        let p = PowerPair::Upper;
        assert_eq!(p.root_string(), 0); // 6th / low E
        assert_eq!(p.fifth_string(), 1); // 5th / A
        assert_eq!(p.octave_string(), 2); // 4th / D (optional octave)
    }

    #[test]
    fn pair_lower_half_is_5th_4th() {
        let s = strip();
        // Below the midline (midline = 70) and the bottom → Lower.
        assert_eq!(s.pair_at_y(71.0), Some(PowerPair::Lower));
        assert_eq!(s.pair_at_y(90.0), Some(PowerPair::Lower));
        let p = PowerPair::Lower;
        assert_eq!(p.root_string(), 1); // 5th / A
        assert_eq!(p.fifth_string(), 2); // 4th / D
        assert_eq!(p.octave_string(), 3); // 3rd / G (optional octave)
    }

    #[test]
    fn pair_midline_counts_as_upper() {
        let s = strip();
        // Midline of [50,90] is 70; exactly on it reads as the upper half.
        assert_eq!(s.pair_at_y(70.0), Some(PowerPair::Upper));
    }

    #[test]
    fn pair_outside_vertical_span_is_none() {
        let s = strip();
        assert_eq!(s.pair_at_y(49.0), None); // above the strip
        assert_eq!(s.pair_at_y(91.0), None); // below the strip
        assert_eq!(s.pair_at_y(f64::INFINITY), None);
    }

    #[test]
    fn contains_tests_the_whole_rect() {
        let s = strip();
        assert!(s.contains(260.0, 70.0)); // centre
        assert!(s.contains(200.0, 50.0)); // top-left corner (inclusive)
        assert!(s.contains(330.0, 90.0)); // bottom-right corner (inclusive)
        assert!(!s.contains(260.0, 49.0)); // just above
        assert!(!s.contains(199.0, 70.0)); // just left
        assert!(!s.contains(f64::NAN, 70.0));
    }

    #[test]
    fn fret_marker_x_is_cell_centre() {
        let s = strip();
        // Cell f centre = 200 + 10f + 5.
        assert!((s.fret_marker_x(0) - 205.0).abs() < 1e-9);
        assert!((s.fret_marker_x(6) - 265.0).abs() < 1e-9);
        assert!((s.fret_marker_x(12) - 325.0).abs() < 1e-9);
        // A fret past the max clamps to the last cell's centre.
        assert!((s.fret_marker_x(99) - 325.0).abs() < 1e-9);
        // Every marker lands strictly inside the strip and back in its own cell.
        for f in 0..=12u32 {
            let mx = s.fret_marker_x(f);
            assert!(mx > 200.0 && mx < 330.0);
            assert_eq!(s.fret_at_x(mx), Some(f), "marker {f} round-trips");
        }
    }

    #[test]
    fn edges_normalised_regardless_of_argument_order() {
        // Swapped corners must produce the same strip.
        let a = PowerStripCore::new(330.0, 90.0, 200.0, 50.0, DEFAULT_MAX_FRET);
        assert_eq!(a.rect(), (200.0, 50.0, 330.0, 90.0));
        assert_eq!(a.fret_at_x(205.0), Some(0));
        assert_eq!(a.pair_at_y(55.0), Some(PowerPair::Upper));
    }

    #[test]
    fn degenerate_rect_does_not_panic_or_divide_by_zero() {
        let s = PowerStripCore::new(100.0, 100.0, 100.0, 100.0, DEFAULT_MAX_FRET);
        let (l, t, r, b) = s.rect();
        assert!(r > l && b > t);
        // Queries stay finite and don't panic.
        let _ = s.fret_at_x(100.0);
        let _ = s.pair_at_y(100.0);
        assert!(s.fret_marker_x(0).is_finite());
    }

    #[test]
    fn non_finite_rect_is_floored() {
        let s = PowerStripCore::new(f64::NAN, 0.0, f64::INFINITY, 10.0, DEFAULT_MAX_FRET);
        let (l, t, r, b) = s.rect();
        assert!(l.is_finite() && t.is_finite() && r.is_finite() && b.is_finite());
        assert!(r > l && b > t);
    }

    #[test]
    fn max_fret_floored_to_at_least_one() {
        let s = PowerStripCore::new(0.0, 0.0, 100.0, 10.0, 0);
        assert_eq!(s.max_fret(), 1);
        assert_eq!(s.fret_count(), 2);
    }

    #[test]
    fn custom_max_fret_is_honoured() {
        // A 5-fret strip (0..=5 → 6 cells) 120px wide → 20px cells.
        let s = PowerStripCore::new(0.0, 0.0, 120.0, 40.0, 5);
        assert_eq!(s.max_fret(), 5);
        assert_eq!(s.fret_count(), 6);
        assert_eq!(s.fret_at_x(10.0), Some(0));
        assert_eq!(s.fret_at_x(119.0), Some(5));
        assert_eq!(s.fret_at_x(120.0), Some(5)); // right edge clamps
    }

    #[test]
    fn pair_from_i32_decodes_boundary_encoding() {
        assert_eq!(pair_from_i32(0), Some(PowerPair::Upper));
        assert_eq!(pair_from_i32(1), Some(PowerPair::Lower));
        assert_eq!(pair_from_i32(-1), None);
        assert_eq!(pair_from_i32(2), None);
    }

    #[test]
    fn wrapper_string_indices_match_pairs() {
        let w = PowerStrip::new(0.0, 0.0, 130.0, 40.0, DEFAULT_MAX_FRET);
        // Upper (0): 0,1,2.
        assert_eq!(w.root_string(0), 0);
        assert_eq!(w.fifth_string(0), 1);
        assert_eq!(w.octave_string(0), 2);
        // Lower (1): 1,2,3.
        assert_eq!(w.root_string(1), 1);
        assert_eq!(w.fifth_string(1), 2);
        assert_eq!(w.octave_string(1), 3);
        // Invalid pair → -1.
        assert_eq!(w.root_string(-1), -1);
        assert_eq!(w.fifth_string(9), -1);
    }

    #[test]
    fn wrapper_boundary_encoding() {
        let w = PowerStrip::new(200.0, 50.0, 330.0, 90.0, DEFAULT_MAX_FRET);
        assert_eq!(w.fret_at_x(205.0), 0);
        assert_eq!(w.fret_at_x(100.0), -1); // off strip
        assert_eq!(w.pair_at_y(55.0), 0); // upper
        assert_eq!(w.pair_at_y(85.0), 1); // lower
        assert_eq!(w.pair_at_y(10.0), -1); // off strip
        assert!(w.contains(260.0, 70.0));
    }
}
