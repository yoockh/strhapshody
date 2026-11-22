//! Right-hand shape gestures (task 2.3 / PRD §8).
//!
//! The strum module (`strum.rs`) tracks the right hand as a single moving point
//! and turns its vertical motion into string crossings. On top of that, PRD §8
//! gives two *hand-shape* modifiers that change how (or whether) those crossings
//! sound:
//!
//! | Hand shape                         | Result                                |
//! | ---------------------------------- | ------------------------------------- |
//! | Open palm held flat over strings   | **Palm mute** (short, dull notes)     |
//! | Closed fist                        | **Stop** (silences all strings)       |
//!
//! This module classifies a single hand's 21 MediaPipe landmarks into one of
//! [`HandShape::Neutral`] (normal strumming), [`HandShape::OpenPalm`] (palm
//! mute), or [`HandShape::Fist`] (stop). Pure, deterministic Rust (ADR-0002):
//! no camera, no audio, no browser APIs — it is handed the already-detected
//! landmark coordinates and returns a decision, so it is fully `cargo test`-able
//! with synthetic hand-shape landmark sets.
//!
//! ## Landmark input format
//!
//! The 21 MediaPipe hand landmarks are passed as a flat slice of **interleaved
//! `x, y` pairs** (length 42): `[x0, y0, x1, y1, ..., x20, y20]`. Only the
//! image-plane `x, y` are used — MediaPipe's `z` is relative and noisier, and the
//! open-palm/fist distinction is already clear in the image plane. Coordinates may
//! be normalized ([0,1]) or in pixels; every metric here is a *ratio* of
//! distances, so it is invariant to translation, scale and rotation of the hand.
//!
//! ## How a finger is judged extended vs. curled
//!
//! For a finger with joints MCP → PIP → DIP → TIP, the **straightness ratio** is
//!
//! ```text
//!   ratio = dist(MCP, TIP) / ( dist(MCP,PIP) + dist(PIP,DIP) + dist(DIP,TIP) )
//! ```
//!
//! i.e. the straight-line tip-to-knuckle distance divided by the length of the
//! finger following its joints. A straight finger has tip-to-knuckle ≈ the summed
//! segment length, so `ratio ≈ 1`; a finger curled back toward the palm brings the
//! tip near the knuckle, so `ratio` collapses toward 0. A finger counts as
//! **extended** at `ratio >= EXTENDED_MIN`, **curled** at `ratio <= CURLED_MAX`,
//! and anything between is ambiguous (contributes to neither). The gap between the
//! two thresholds is a deliberate dead zone so a half-open hand reads as `Neutral`
//! rather than flickering between palm-mute and stop.
//!
//! The thumb is intentionally ignored: its geometry differs from the fingers and
//! it is far noisier, and both target shapes are unambiguous from the four fingers
//! (index, middle, ring, pinky) alone. `OpenPalm` requires all four extended;
//! `Fist` requires all four curled; everything else is `Neutral`.
//!
//! ## Debouncing
//!
//! Per-frame classification is wrapped in a small debounce ([`GestureCore`]): a new
//! shape must persist for `hold_frames` consecutive frames before it is committed,
//! so a single noisy frame can't momentarily cut the sound. The caller reads the
//! committed shape each frame and calls [`GestureCore::reset`] when tracking is
//! lost so a stale mute/stop doesn't linger.

use wasm_bindgen::prelude::*;

/// A classified right-hand shape (PRD §8).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HandShape {
    /// Normal strumming hand — neither a flat open palm nor a closed fist.
    Neutral,
    /// Open palm held flat (all four fingers extended) → palm mute.
    OpenPalm,
    /// Closed fist (all four fingers curled) → stop / silence.
    Fist,
}

/// Number of interleaved coordinates expected: 21 landmarks * 2 (x, y).
pub(crate) const LANDMARK_COORDS: usize = 42;

/// A finger at or above this straightness ratio is considered **extended**.
pub const EXTENDED_MIN: f64 = 0.80;
/// A finger at or below this straightness ratio is considered **curled**.
pub const CURLED_MAX: f64 = 0.60;

/// Default debounce: how many consecutive frames a new shape must hold before it
/// is committed. ~3 frames at 30–60 Hz is a few tens of ms, short enough to feel
/// instant but long enough to reject a single bad frame.
pub const DEFAULT_HOLD_FRAMES: u32 = 3;

// MediaPipe hand-landmark indices (https://developers.google.com/mediapipe).
// Each finger is (MCP, PIP, DIP, TIP). Shared with the `fingercount` module
// (task 3.3) which classifies the left hand's extended-finger count with the
// same landmark boundary + straightness metric (ADR-0008).
pub(crate) const INDEX_FINGER: [usize; 4] = [5, 6, 7, 8];
pub(crate) const MIDDLE_FINGER: [usize; 4] = [9, 10, 11, 12];
pub(crate) const RING_FINGER: [usize; 4] = [13, 14, 15, 16];
pub(crate) const PINKY_FINGER: [usize; 4] = [17, 18, 19, 20];

/// Read landmark `i` as an `(x, y)` point from the interleaved slice.
#[inline]
fn point(landmarks: &[f64], i: usize) -> (f64, f64) {
    (landmarks[2 * i], landmarks[2 * i + 1])
}

#[inline]
fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    let dx = a.0 - b.0;
    let dy = a.1 - b.1;
    (dx * dx + dy * dy).sqrt()
}

/// Straightness ratio for one finger, or `None` if the finger is degenerate
/// (zero-length — all four joints coincident), which carries no shape information.
fn finger_straightness(landmarks: &[f64], finger: [usize; 4]) -> Option<f64> {
    let mcp = point(landmarks, finger[0]);
    let pip = point(landmarks, finger[1]);
    let dip = point(landmarks, finger[2]);
    let tip = point(landmarks, finger[3]);

    let path = dist(mcp, pip) + dist(pip, dip) + dist(dip, tip);
    if path <= 0.0 {
        return None;
    }
    Some(dist(mcp, tip) / path)
}

/// Per-finger verdict: `Some(true)` extended, `Some(false)` curled, `None`
/// ambiguous (between the thresholds, or degenerate). Shared with `fingercount`.
pub(crate) fn finger_extended(landmarks: &[f64], finger: [usize; 4]) -> Option<bool> {
    match finger_straightness(landmarks, finger) {
        Some(r) if r >= EXTENDED_MIN => Some(true),
        Some(r) if r <= CURLED_MAX => Some(false),
        _ => None,
    }
}

/// True iff the slice is the expected length and every coordinate is finite.
pub(crate) fn landmarks_valid(landmarks: &[f64]) -> bool {
    landmarks.len() == LANDMARK_COORDS && landmarks.iter().all(|v| v.is_finite())
}

/// Classify a single frame of landmarks into a [`HandShape`], stateless.
///
/// Returns [`HandShape::Neutral`] when the input is the wrong length, contains a
/// non-finite coordinate, or the hand is neither a clear flat palm nor a clear
/// fist. `OpenPalm` requires all four fingers extended; `Fist` requires all four
/// curled.
pub fn classify_shape(landmarks: &[f64]) -> HandShape {
    if !landmarks_valid(landmarks) {
        return HandShape::Neutral;
    }

    let fingers = [INDEX_FINGER, MIDDLE_FINGER, RING_FINGER, PINKY_FINGER];
    let mut all_extended = true;
    let mut all_curled = true;
    for f in fingers {
        match finger_extended(landmarks, f) {
            Some(true) => all_curled = false,
            Some(false) => all_extended = false,
            None => {
                all_extended = false;
                all_curled = false;
            }
        }
    }

    match (all_extended, all_curled) {
        (true, false) => HandShape::OpenPalm,
        (false, true) => HandShape::Fist,
        _ => HandShape::Neutral,
    }
}

/// Pure core of the gesture detector (wasm-free, per ADR-0002), holding the
/// debounce state. The exported [`GestureDetector`] is a thin wrapper.
#[derive(Clone, Debug)]
pub struct GestureCore {
    hold_frames: u32,
    committed: HandShape,
    candidate: HandShape,
    candidate_count: u32,
}

impl GestureCore {
    /// New detector starting in `Neutral`. `hold_frames` is how many consecutive
    /// frames a new shape must persist before it is committed; `0` is treated as
    /// `1` (commit immediately, no debounce).
    pub fn new(hold_frames: u32) -> Self {
        GestureCore {
            hold_frames: hold_frames.max(1),
            committed: HandShape::Neutral,
            candidate: HandShape::Neutral,
            candidate_count: 0,
        }
    }

    /// The currently committed (debounced) hand shape.
    pub fn current(&self) -> HandShape {
        self.committed
    }

    /// Feed one frame of landmarks and return the committed shape after the
    /// debounce. Invalid frames (wrong length / non-finite) are classified as
    /// `Neutral` like any other frame, so losing the hand decays to `Neutral`
    /// after `hold_frames` rather than latching a stale mute/stop.
    pub fn update(&mut self, landmarks: &[f64]) -> HandShape {
        let raw = classify_shape(landmarks);

        if raw == self.committed {
            // Already there — clear any half-formed switch to the previous state.
            self.candidate = self.committed;
            self.candidate_count = 0;
        } else if raw == self.candidate {
            self.candidate_count += 1;
            if self.candidate_count >= self.hold_frames {
                self.committed = raw;
                self.candidate_count = 0;
            }
        } else {
            // A different shape than we were tracking — start a fresh count.
            self.candidate = raw;
            self.candidate_count = 1;
            if self.candidate_count >= self.hold_frames {
                self.committed = raw;
                self.candidate_count = 0;
            }
        }
        self.committed
    }

    /// Reset to `Neutral` with no pending candidate. Call when tracking is lost or
    /// the hand leaves the strum zone.
    pub fn reset(&mut self) {
        self.committed = HandShape::Neutral;
        self.candidate = HandShape::Neutral;
        self.candidate_count = 0;
    }
}

/// WASM-exported gesture detector. One instance tracks one hand's shape over time.
#[wasm_bindgen]
pub struct GestureDetector {
    inner: GestureCore,
}

#[wasm_bindgen]
impl GestureDetector {
    /// See [`GestureCore::new`]. Exposed to JS as `new GestureDetector(holdFrames)`.
    #[wasm_bindgen(constructor)]
    pub fn new(hold_frames: u32) -> GestureDetector {
        GestureDetector {
            inner: GestureCore::new(hold_frames),
        }
    }

    /// See [`GestureCore::update`]. `landmarks` is a `Float64Array` of 42
    /// interleaved `x, y` values (21 MediaPipe landmarks).
    pub fn update(&mut self, landmarks: &[f64]) -> HandShape {
        self.inner.update(landmarks)
    }

    /// See [`GestureCore::current`].
    #[wasm_bindgen(getter)]
    pub fn current(&self) -> HandShape {
        self.inner.current()
    }

    /// See [`GestureCore::reset`].
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// Stateless single-frame classification, exported for callers that want the raw
/// per-frame shape without the debounce. See [`classify_shape`].
#[wasm_bindgen(js_name = classifyHandShape)]
pub fn classify_hand_shape(landmarks: &[f64]) -> HandShape {
    classify_shape(landmarks)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Finger bases (MCP x) for index, middle, ring, pinky, left→right.
    const FINGER_BASE_X: [f64; 4] = [0.30, 0.40, 0.50, 0.60];

    /// Build a full 42-value landmark array from a per-finger extended flag.
    ///
    /// `extended[k] == true`  → a straight vertical finger (ratio ≈ 1).
    /// `extended[k] == false` → a finger curled back toward its knuckle (ratio ≈ 0).
    /// Order is [index, middle, ring, pinky]. Wrist + thumb are filled with plausible
    /// values that never participate in the classification.
    fn hand(extended: [bool; 4]) -> Vec<f64> {
        // 21 (x, y) points, default to the wrist area; overwrite the finger joints.
        let mut pts = [(0.45, 0.80); 21];
        // Thumb chain (ignored by the classifier) — just off to the side.
        pts[1] = (0.25, 0.75);
        pts[2] = (0.20, 0.70);
        pts[3] = (0.17, 0.66);
        pts[4] = (0.14, 0.62);

        let fingers = [INDEX_FINGER, MIDDLE_FINGER, RING_FINGER, PINKY_FINGER];
        for (k, finger) in fingers.iter().enumerate() {
            let bx = FINGER_BASE_X[k];
            let [mcp, pip, dip, tip] = *finger;
            if extended[k] {
                // Straight line going up (decreasing y): tip far from MCP.
                pts[mcp] = (bx, 0.60);
                pts[pip] = (bx, 0.50);
                pts[dip] = (bx, 0.40);
                pts[tip] = (bx, 0.30);
            } else {
                // Curled: out a little then folded back so tip sits by the MCP.
                pts[mcp] = (bx, 0.60);
                pts[pip] = (bx, 0.50);
                pts[dip] = (bx, 0.55);
                pts[tip] = (bx, 0.61);
            }
        }

        let mut flat = Vec::with_capacity(LANDMARK_COORDS);
        for (x, y) in pts {
            flat.push(x);
            flat.push(y);
        }
        flat
    }

    #[test]
    fn straight_finger_ratio_is_near_one() {
        let h = hand([true, true, true, true]);
        let r = finger_straightness(&h, INDEX_FINGER).unwrap();
        assert!(r > 0.99, "straight finger ratio {r} should be ~1");
    }

    #[test]
    fn curled_finger_ratio_is_small() {
        let h = hand([false, false, false, false]);
        let r = finger_straightness(&h, INDEX_FINGER).unwrap();
        assert!(r < CURLED_MAX, "curled finger ratio {r} should be <= {CURLED_MAX}");
    }

    #[test]
    fn open_palm_all_fingers_extended() {
        let h = hand([true, true, true, true]);
        assert_eq!(classify_shape(&h), HandShape::OpenPalm);
    }

    #[test]
    fn fist_all_fingers_curled() {
        let h = hand([false, false, false, false]);
        assert_eq!(classify_shape(&h), HandShape::Fist);
    }

    #[test]
    fn partial_hand_is_neutral() {
        // Index + middle extended, ring + pinky curled → neither palm nor fist.
        let h = hand([true, true, false, false]);
        assert_eq!(classify_shape(&h), HandShape::Neutral);
        // A single curled finger breaks an otherwise-open palm.
        let h = hand([true, true, true, false]);
        assert_eq!(classify_shape(&h), HandShape::Neutral);
        // A single extended finger breaks an otherwise-closed fist.
        let h = hand([false, false, false, true]);
        assert_eq!(classify_shape(&h), HandShape::Neutral);
    }

    #[test]
    fn wrong_length_input_is_neutral() {
        assert_eq!(classify_shape(&[]), HandShape::Neutral);
        assert_eq!(classify_shape(&[0.0; 10]), HandShape::Neutral);
        assert_eq!(classify_shape(&[0.0; 63]), HandShape::Neutral);
    }

    #[test]
    fn non_finite_input_is_neutral() {
        let mut h = hand([true, true, true, true]);
        h[16] = f64::NAN;
        assert_eq!(classify_shape(&h), HandShape::Neutral);
        let mut h = hand([false, false, false, false]);
        h[0] = f64::INFINITY;
        assert_eq!(classify_shape(&h), HandShape::Neutral);
    }

    #[test]
    fn degenerate_finger_is_ambiguous_not_a_crash() {
        // All four joints of every finger coincident → zero path length → None,
        // so the hand can't be a clear palm or fist: Neutral, no div-by-zero.
        let flat = vec![0.5_f64; LANDMARK_COORDS];
        assert!(finger_straightness(&flat, INDEX_FINGER).is_none());
        assert_eq!(classify_shape(&flat), HandShape::Neutral);
    }

    #[test]
    fn classification_is_rotation_and_scale_invariant() {
        // Rotate + scale + translate a fist and it must still read as a fist,
        // because every metric is a ratio of distances.
        let h = hand([false, false, false, false]);
        let (s, theta, tx, ty) = (2.5_f64, 0.7_f64, 1.3_f64, -0.4_f64);
        let (c, sn) = (theta.cos(), theta.sin());
        let mut t = Vec::with_capacity(LANDMARK_COORDS);
        let mut i = 0;
        while i < h.len() {
            let (x, y) = (h[i], h[i + 1]);
            t.push(s * (x * c - y * sn) + tx);
            t.push(s * (x * sn + y * c) + ty);
            i += 2;
        }
        assert_eq!(classify_shape(&t), HandShape::Fist);
    }

    #[test]
    fn debounce_requires_hold_frames_to_commit() {
        let mut d = GestureCore::new(3);
        let palm = hand([true, true, true, true]);
        assert_eq!(d.current(), HandShape::Neutral);
        // First two palm frames are not enough to commit.
        assert_eq!(d.update(&palm), HandShape::Neutral);
        assert_eq!(d.update(&palm), HandShape::Neutral);
        // Third consecutive palm frame commits it.
        assert_eq!(d.update(&palm), HandShape::OpenPalm);
    }

    #[test]
    fn debounce_rejects_single_noisy_frame() {
        let mut d = GestureCore::new(3);
        let palm = hand([true, true, true, true]);
        let fist = hand([false, false, false, false]);
        // Commit the palm.
        d.update(&palm);
        d.update(&palm);
        assert_eq!(d.update(&palm), HandShape::OpenPalm);
        // One stray fist frame must not flip the committed shape.
        assert_eq!(d.update(&fist), HandShape::OpenPalm);
        // Returning to palm clears the pending switch.
        assert_eq!(d.update(&palm), HandShape::OpenPalm);
    }

    #[test]
    fn debounce_switches_after_sustained_change() {
        let mut d = GestureCore::new(2);
        let palm = hand([true, true, true, true]);
        let fist = hand([false, false, false, false]);
        d.update(&palm);
        assert_eq!(d.update(&palm), HandShape::OpenPalm);
        // Two sustained fist frames flip it.
        assert_eq!(d.update(&fist), HandShape::OpenPalm);
        assert_eq!(d.update(&fist), HandShape::Fist);
    }

    #[test]
    fn hold_frames_zero_commits_immediately() {
        let mut d = GestureCore::new(0); // treated as 1
        let fist = hand([false, false, false, false]);
        assert_eq!(d.update(&fist), HandShape::Fist);
    }

    #[test]
    fn reset_returns_to_neutral() {
        let mut d = GestureCore::new(1);
        let fist = hand([false, false, false, false]);
        assert_eq!(d.update(&fist), HandShape::Fist);
        d.reset();
        assert_eq!(d.current(), HandShape::Neutral);
    }

    #[test]
    fn lost_hand_decays_to_neutral() {
        let mut d = GestureCore::new(2);
        let palm = hand([true, true, true, true]);
        d.update(&palm);
        assert_eq!(d.update(&palm), HandShape::OpenPalm);
        // Hand lost → invalid frames classify as Neutral; after hold_frames it decays.
        let empty: Vec<f64> = Vec::new();
        assert_eq!(d.update(&empty), HandShape::OpenPalm);
        assert_eq!(d.update(&empty), HandShape::Neutral);
    }
}
