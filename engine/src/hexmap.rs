//! Hex-grid chord map (task 3.1 / PRD §6.1).
//!
//! The left hand's **palm centre** is a cursor over a "flower" of 7 hexagonal
//! cells — one per letter chord A–G. The centre cell is C; the six ring cells,
//! clockwise from the top, follow the circle of fifths: G, D, A, E, B, F. This
//! module owns the pure geometry:
//!
//! - the layout math (where the 7 cell centres sit, given the flower centre and
//!   a hex size),
//! - the point-in-hex test (which cell, if any, a cursor point is inside),
//! - **hysteresis** at the borders so a cursor hovering on a seam between two
//!   cells doesn't flicker back and forth between the two chords (PRD §6.1).
//!
//! Pure, deterministic Rust (ADR-0002): no camera, no audio, no browser APIs.
//! It is fed cursor coordinates already in canvas pixels (the frontend maps the
//! smoothed palm centre through the same cover-crop+mirror transform the overlay
//! uses, exactly as the strum point is in task 2.4), and is fully `cargo
//! test`-able with synthetic cursor trajectories.
//!
//! ## Geometry
//!
//! The cells are **flat-top** regular hexagons (a flat edge on top), because a
//! flat-top hex has a neighbour directly above it — which is what "G at the top
//! of the ring" requires. For a hex of circumradius `R` (centre to vertex), the
//! six ring cells sit at centre-to-centre distance `√3·R` (two apothems) from
//! the centre cell, at 60° intervals clockwise from straight up. In screen
//! coordinates (y increases downward) that gives these offsets from the flower
//! centre:
//!
//! | idx | chord | offset (dx, dy)         |
//! |-----|-------|-------------------------|
//! | 0   | C     | (0, 0)          centre  |
//! | 1   | G     | (0, -√3·R)      top     |
//! | 2   | D     | (+3R/2, -√3R/2) up-right|
//! | 3   | A     | (+3R/2, +√3R/2) dn-right|
//! | 4   | E     | (0, +√3·R)      bottom  |
//! | 5   | B     | (-3R/2, +√3R/2) dn-left |
//! | 6   | F     | (-3R/2, -√3R/2) up-left |
//!
//! ## Point-in-hex
//!
//! A regular hexagonal tiling is the Voronoi diagram of its cell centres, so the
//! cell a point falls in is the one with the nearest centre — *provided* the
//! point is actually inside that hexagon (the flower's outer edges have no
//! neighbour, so a point just outside the flower must read as "no cell"). We
//! therefore pick the nearest centre and then confirm containment with an exact
//! flat-top-hexagon test. A flat-top hexagon of circumradius `r` centred at the
//! origin contains a local point `(dx, dy)` iff:
//!
//! ```text
//! |dy| <= (√3/2)·r            (flat top / bottom edges)
//! √3·|dx| + |dy| <= √3·r      (the four slanted edges)
//! ```
//!
//! ## Hysteresis
//!
//! The selector is **stateful**: it remembers the currently-selected cell. A
//! cursor keeps its current cell while it stays within that cell *inflated* by
//! `margin` (circumradius `R + margin`); it only adopts a different cell once it
//! is *deep* inside that other cell (inside it *deflated* to `R - margin`), or
//! once it has left the inflated current cell entirely. This puts a dead band of
//! total width `√3·margin` around every seam, so a cursor resting on a border
//! holds one chord steady instead of chattering between two (PRD §6.1,
//! "must move a little past the border to switch").

use wasm_bindgen::prelude::*;

const SQRT_3: f64 = 1.732_050_807_568_877_2;
const HALF_SQRT_3: f64 = SQRT_3 / 2.0;

/// Number of cells in the flower (one per letter chord A–G).
pub const CELL_COUNT: usize = 7;

/// Chord letters by cell index: 0 = centre C, then the ring clockwise from the
/// top following the circle of fifths (PRD §6.1).
pub const CELL_CHORDS: [&str; CELL_COUNT] = ["C", "G", "D", "A", "E", "B", "F"];

/// `true` iff local point `(dx, dy)` is inside a flat-top regular hexagon of
/// circumradius `r` centred at the origin. A non-positive `r` contains nothing.
fn in_flat_top_hex(dx: f64, dy: f64, r: f64) -> bool {
    if !(r > 0.0) {
        return false;
    }
    let adx = dx.abs();
    let ady = dy.abs();
    // flat top/bottom edges, then the four slanted edges.
    ady <= HALF_SQRT_3 * r && SQRT_3 * adx + ady <= SQRT_3 * r
}

/// Pure (wasm-free) hex-flower chord selector. Holds the layout and the
/// current-cell hysteresis state. See the module docs for the geometry.
#[derive(Clone, Debug)]
pub struct HexCore {
    cx: f64,
    cy: f64,
    radius: f64,
    margin: f64,
    centers: [(f64, f64); CELL_COUNT],
    current: Option<usize>,
}

impl HexCore {
    /// Build a flower centred at `(cx, cy)` with hex circumradius `radius`, and a
    /// hysteresis `margin` (same pixel units). `radius` is floored to a tiny
    /// positive value; `margin` is sanitised to `[0, 0.49·radius]` so the
    /// deflated hex stays sensibly positive and non-finite input can't poison the
    /// layout.
    pub fn new(cx: f64, cy: f64, radius: f64, margin: f64) -> Self {
        let cx = if cx.is_finite() { cx } else { 0.0 };
        let cy = if cy.is_finite() { cy } else { 0.0 };
        let radius = if radius.is_finite() && radius > 1e-6 {
            radius
        } else {
            1e-6
        };
        let margin = if margin.is_finite() && margin > 0.0 {
            margin.min(0.49 * radius)
        } else {
            0.0
        };

        let r = radius;
        // Offsets from the flower centre, in screen coords (y down), matching the
        // table in the module docs.
        let centers = [
            (cx, cy),                               // C  centre
            (cx, cy - SQRT_3 * r),                  // G  top
            (cx + 1.5 * r, cy - HALF_SQRT_3 * r),   // D  up-right
            (cx + 1.5 * r, cy + HALF_SQRT_3 * r),   // A  down-right
            (cx, cy + SQRT_3 * r),                  // E  bottom
            (cx - 1.5 * r, cy + HALF_SQRT_3 * r),   // B  down-left
            (cx - 1.5 * r, cy - HALF_SQRT_3 * r),   // F  up-left
        ];

        Self {
            cx,
            cy,
            radius,
            margin,
            centers,
            current: None,
        }
    }

    /// The `(x, y)` centre of cell `i` in canvas pixels.
    pub fn center(&self, i: usize) -> (f64, f64) {
        self.centers[i]
    }

    /// Hex circumradius in pixels.
    pub fn radius(&self) -> f64 {
        self.radius
    }

    /// Flower centre in pixels.
    pub fn flower_center(&self) -> (f64, f64) {
        (self.cx, self.cy)
    }

    /// Index of the cell centre nearest to `(px, py)` (always some cell — this
    /// does not test containment). `None` only if the point is non-finite.
    fn nearest_index(&self, px: f64, py: f64) -> Option<usize> {
        if !px.is_finite() || !py.is_finite() {
            return None;
        }
        let mut best = 0usize;
        let mut best_d2 = f64::INFINITY;
        for (i, &(x, y)) in self.centers.iter().enumerate() {
            let dx = px - x;
            let dy = py - y;
            let d2 = dx * dx + dy * dy;
            if d2 < best_d2 {
                best_d2 = d2;
                best = i;
            }
        }
        Some(best)
    }

    /// `true` iff `(px, py)` is inside cell `i` grown/shrunk to circumradius
    /// `radius + extra`.
    fn in_cell(&self, px: f64, py: f64, i: usize, extra: f64) -> bool {
        let (x, y) = self.centers[i];
        in_flat_top_hex(px - x, py - y, self.radius + extra)
    }

    /// Stateless selection: which cell *contains* `(px, py)`, or `None` if the
    /// point is outside the whole flower. Does not touch or use hysteresis state.
    pub fn raw_cell(&self, px: f64, py: f64) -> Option<usize> {
        let j = self.nearest_index(px, py)?;
        if self.in_cell(px, py, j, 0.0) {
            Some(j)
        } else {
            None
        }
    }

    /// Stateful selection with border hysteresis. Returns the selected cell for
    /// this cursor sample, or `None` when the cursor is clearly outside every
    /// cell. See the module docs for the dead-band behaviour.
    pub fn update(&mut self, px: f64, py: f64) -> Option<usize> {
        if !px.is_finite() || !py.is_finite() {
            // Treat garbage as "no reading" without disturbing the held cell, so
            // a single bad frame doesn't drop the current chord.
            return self.current;
        }

        match self.current {
            None => {
                // No cell held yet: acquire fresh, no hysteresis to apply.
                self.current = self.raw_cell(px, py);
            }
            Some(i) => {
                if self.in_cell(px, py, i, self.margin) {
                    // Still within the (inflated) current cell: stick with it
                    // unless the cursor is now *deep* inside a different cell.
                    let mut switched = false;
                    for j in 0..CELL_COUNT {
                        if j != i && self.in_cell(px, py, j, -self.margin) {
                            self.current = Some(j);
                            switched = true;
                            break;
                        }
                    }
                    let _ = switched;
                } else {
                    // Left the current cell's inflated region entirely: re-acquire
                    // (may land on a neighbour, or on nothing between cells).
                    self.current = self.raw_cell(px, py);
                }
            }
        }
        self.current
    }

    /// The currently-held cell, without feeding a new sample.
    pub fn current(&self) -> Option<usize> {
        self.current
    }

    /// Clear the held cell (call on tracking loss / hand leaving the left zone so
    /// the next sample re-acquires instead of sticking to a stale chord).
    pub fn reset(&mut self) {
        self.current = None;
    }
}

/// Thin `#[wasm_bindgen]` wrapper over [`HexCore`] (ADR-0002 split). Cell indices
/// cross the boundary as `i32`, with `-1` meaning "no cell" so the frontend
/// doesn't need an Option shim.
#[wasm_bindgen]
pub struct HexMap {
    core: HexCore,
}

#[wasm_bindgen]
impl HexMap {
    /// `new HexMap(cx, cy, radius, margin)` — see [`HexCore::new`].
    #[wasm_bindgen(constructor)]
    pub fn new(cx: f64, cy: f64, radius: f64, margin: f64) -> HexMap {
        HexMap {
            core: HexCore::new(cx, cy, radius, margin),
        }
    }

    /// Feed a cursor sample; returns the selected cell index (0..6) with
    /// hysteresis applied, or `-1` for "no cell".
    pub fn update(&mut self, px: f64, py: f64) -> i32 {
        to_i32(self.core.update(px, py))
    }

    /// Stateless containment test; returns the cell index (0..6) the point is
    /// inside, or `-1`. Does not affect hysteresis state.
    #[wasm_bindgen(js_name = rawCell)]
    pub fn raw_cell(&self, px: f64, py: f64) -> i32 {
        to_i32(self.core.raw_cell(px, py))
    }

    /// The currently-held cell index, or `-1`.
    pub fn current(&self) -> i32 {
        to_i32(self.core.current())
    }

    /// Clear the held cell (call on tracking loss).
    pub fn reset(&mut self) {
        self.core.reset();
    }

    /// Hex circumradius in pixels.
    pub fn radius(&self) -> f64 {
        self.core.radius()
    }

    /// Number of cells (always 7).
    #[wasm_bindgen(js_name = cellCount)]
    pub fn cell_count(&self) -> u32 {
        CELL_COUNT as u32
    }

    /// X of cell `i`'s centre in canvas pixels (NaN if `i` out of range).
    #[wasm_bindgen(js_name = centerX)]
    pub fn center_x(&self, i: u32) -> f64 {
        if (i as usize) < CELL_COUNT {
            self.core.center(i as usize).0
        } else {
            f64::NAN
        }
    }

    /// Y of cell `i`'s centre in canvas pixels (NaN if `i` out of range).
    #[wasm_bindgen(js_name = centerY)]
    pub fn center_y(&self, i: u32) -> f64 {
        if (i as usize) < CELL_COUNT {
            self.core.center(i as usize).1
        } else {
            f64::NAN
        }
    }

    /// The chord letter for cell `i` ("C","G","D","A","E","B","F"); empty string
    /// if `i` is out of range.
    #[wasm_bindgen(js_name = cellChord)]
    pub fn cell_chord(&self, i: u32) -> String {
        CELL_CHORDS
            .get(i as usize)
            .map(|s| s.to_string())
            .unwrap_or_default()
    }
}

fn to_i32(cell: Option<usize>) -> i32 {
    match cell {
        Some(i) => i as i32,
        None => -1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: f64 = 100.0;

    fn flower() -> HexCore {
        // Centred away from the origin to catch any (cx,cy)-offset mistakes.
        HexCore::new(500.0, 400.0, R, 20.0)
    }

    #[test]
    fn centers_follow_circle_of_fifths_layout() {
        let f = flower();
        let (cx, cy) = (500.0, 400.0);
        let expect = [
            (cx, cy),                                // C
            (cx, cy - SQRT_3 * R),                   // G top
            (cx + 1.5 * R, cy - HALF_SQRT_3 * R),    // D up-right
            (cx + 1.5 * R, cy + HALF_SQRT_3 * R),    // A down-right
            (cx, cy + SQRT_3 * R),                   // E bottom
            (cx - 1.5 * R, cy + HALF_SQRT_3 * R),    // B down-left
            (cx - 1.5 * R, cy - HALF_SQRT_3 * R),    // F up-left
        ];
        for i in 0..CELL_COUNT {
            let (x, y) = f.center(i);
            assert!((x - expect[i].0).abs() < 1e-9, "cell {i} x");
            assert!((y - expect[i].1).abs() < 1e-9, "cell {i} y");
        }
        // All ring cells equidistant from the centre at √3·R.
        let d = SQRT_3 * R;
        for i in 1..CELL_COUNT {
            let (x, y) = f.center(i);
            let dist = ((x - cx).powi(2) + (y - cy).powi(2)).sqrt();
            assert!((dist - d).abs() < 1e-9, "ring cell {i} distance");
        }
    }

    #[test]
    fn chord_labels_match_spec() {
        assert_eq!(CELL_CHORDS, ["C", "G", "D", "A", "E", "B", "F"]);
    }

    #[test]
    fn raw_cell_hits_each_center() {
        let f = flower();
        for i in 0..CELL_COUNT {
            let (x, y) = f.center(i);
            assert_eq!(f.raw_cell(x, y), Some(i), "centre of cell {i}");
        }
    }

    #[test]
    fn raw_cell_center_hex_interior() {
        let f = flower();
        // Just inside the centre hex near its top edge (border at -√3/2·R).
        assert_eq!(f.raw_cell(500.0, 400.0 - 80.0), Some(0));
        // Small horizontal offset still inside C.
        assert_eq!(f.raw_cell(500.0 + 40.0, 400.0), Some(0));
    }

    #[test]
    fn raw_cell_outside_flower_is_none() {
        let f = flower();
        // Far above the flower, well past G.
        assert_eq!(f.raw_cell(500.0, 400.0 - 1000.0), None);
        // Far to the side.
        assert_eq!(f.raw_cell(500.0 + 1000.0, 400.0), None);
        // In the gap just outside the flower's outer slanted edge of D:
        // start at D centre and move further out-right along +x past its vertex.
        let (dx, dy) = f.center(2);
        assert_eq!(f.raw_cell(dx + R + 5.0, dy), None);
    }

    #[test]
    fn non_finite_point_selects_nothing() {
        let f = flower();
        assert_eq!(f.raw_cell(f64::NAN, 400.0), None);
        assert_eq!(f.raw_cell(500.0, f64::INFINITY), None);
    }

    #[test]
    fn hysteresis_holds_then_switches_center_to_g() {
        let mut f = flower();
        let cx = 500.0;
        let cy = 400.0;
        // Border between C and G is at y = cy - √3/2·R = 400 - 86.6 = 313.4.
        // Acquire C.
        assert_eq!(f.update(cx, cy - 80.0), Some(0));
        // Just past the border into G's real cell, but inside inflated-C:
        // inflated-C top edge at cy - √3/2·(R+margin) = 400 - 103.9 = 296.1.
        assert_eq!(f.update(cx, cy - 90.0), Some(0), "hysteresis should hold C");
        // Deep enough into G (past -103.9): switches to G.
        assert_eq!(f.update(cx, cy - 110.0), Some(1), "should switch to G");
    }

    #[test]
    fn hysteresis_holds_then_switches_g_back_to_center() {
        let mut f = flower();
        let cx = 500.0;
        let cy = 400.0;
        // Drive into G first.
        f.update(cx, cy - 80.0);
        f.update(cx, cy - 110.0);
        assert_eq!(f.current(), Some(1));
        // Coming back toward the border: inflated-G bottom edge at
        // cy - √3/2·R + √3/2·margin = 400 - 86.6 + 17.3 = 330.7, i.e. y = cy-69.3.
        // y = cy-95 (305) is still inside inflated-G → hold G.
        assert_eq!(f.update(cx, cy - 95.0), Some(1), "hysteresis should hold G");
        // y = cy-60 (340) is past -69.3 → re-acquire C.
        assert_eq!(f.update(cx, cy - 60.0), Some(0), "should switch back to C");
    }

    #[test]
    fn no_flicker_oscillating_on_border() {
        let mut f = flower();
        let cx = 500.0;
        let cy = 400.0;
        // Acquire C from the interior.
        assert_eq!(f.update(cx, cy), Some(0));
        // Border is at cy-86.6; oscillate a frame-sized wobble straddling it.
        for _ in 0..10 {
            assert_eq!(f.update(cx, cy - 86.0), Some(0));
            assert_eq!(f.update(cx, cy - 87.0), Some(0));
        }
    }

    #[test]
    fn leaving_flower_drops_selection() {
        let mut f = flower();
        let cx = 500.0;
        let cy = 400.0;
        assert_eq!(f.update(cx, cy), Some(0));
        // Jump far outside the whole flower.
        assert_eq!(f.update(cx, cy - 1000.0), None);
    }

    #[test]
    fn reset_clears_held_cell() {
        let mut f = flower();
        f.update(500.0, 400.0);
        assert_eq!(f.current(), Some(0));
        f.reset();
        assert_eq!(f.current(), None);
    }

    #[test]
    fn non_finite_update_keeps_current_cell() {
        let mut f = flower();
        assert_eq!(f.update(500.0, 400.0), Some(0));
        // A garbage frame must not drop the held chord.
        assert_eq!(f.update(f64::NAN, f64::NAN), Some(0));
        assert_eq!(f.current(), Some(0));
    }

    #[test]
    fn switch_between_adjacent_ring_cells_requires_depth() {
        let mut f = flower();
        // Acquire G (top), then move horizontally toward D (up-right).
        let (gx, gy) = f.center(1);
        assert_eq!(f.update(gx, gy), Some(1));
        // A point exactly on the G/D seam-ish region but shallow should hold G;
        // the D centre is clearly D.
        let (dx, dy) = f.center(2);
        assert_eq!(f.update(dx, dy), Some(2), "deep in D switches");
    }

    #[test]
    fn degenerate_radius_is_guarded() {
        // Zero / negative / NaN radius must not panic and must not select wildly.
        let f0 = HexCore::new(0.0, 0.0, 0.0, 0.0);
        assert!(f0.radius() > 0.0);
        let fneg = HexCore::new(0.0, 0.0, -50.0, 10.0);
        assert!(fneg.radius() > 0.0);
        let fnan = HexCore::new(0.0, 0.0, f64::NAN, f64::NAN);
        assert!(fnan.radius() > 0.0);
    }

    #[test]
    fn margin_clamped_so_deflated_hex_stays_positive() {
        // An absurd margin must be clamped below the radius (no inverted hex).
        let f = HexCore::new(0.0, 0.0, 100.0, 1000.0);
        // With margin clamped to <= 49, deep-in test still works at a cell centre.
        let mut m = f.clone();
        assert_eq!(m.update(0.0, 0.0), Some(0));
    }

    #[test]
    fn to_i32_maps_none_to_minus_one() {
        assert_eq!(to_i32(Some(0)), 0);
        assert_eq!(to_i32(Some(6)), 6);
        assert_eq!(to_i32(None), -1);
    }
}
