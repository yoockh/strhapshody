//! Left-hand finger-count chord quality (task 3.3 / PRD §6.2).
//!
//! While the left hand hovers a hex to pick the chord *root* (see `hexmap.rs`),
//! the number of extended fingers sets the chord *quality*:
//!
//! | Gesture                     | Quality       | Example |
//! | --------------------------- | ------------- | ------- |
//! | Index only                  | **Major**     | C       |
//! | Index + middle              | **Minor**     | Cm      |
//! | Index + middle + ring       | **Dominant 7**| C7      |
//!
//! Major/minor are the required v1 vocabulary; the dominant-7th gesture is a
//! stretch goal (PRD §6.2), classified here too so the wiring layers (3.4/3.5)
//! can use it when present without another engine change.
//!
//! This is pure, deterministic Rust (ADR-0002): it is handed the already-detected
//! 21 MediaPipe landmarks and returns a decision, so it is fully `cargo test`-able
//! with synthetic finger configurations — no camera, no human.
//!
//! ## Shared boundary + metric (ADR-0008)
//!
//! The hand crosses the WASM boundary exactly as in [`crate::gesture`]: a flat
//! `&[f64]` of 42 interleaved `x, y` values (`[x0,y0, … x20,y20]`), and each
//! finger's extended/curled verdict uses the same translation/scale/rotation
//! invariant **straightness ratio** (`dist(MCP,TIP) / Σ segment lengths`, extended
//! at `ratio ≥ EXTENDED_MIN`, curled at `ratio ≤ CURLED_MAX`, dead zone between).
//! The per-finger primitives are reused from `gesture.rs` rather than duplicated.
//!
//! ## What counts as a clean gesture
//!
//! The three qualities are the contiguous runs index → index+middle →
//! index+middle+ring of *clearly extended* fingers, with every finger past the run
//! — **including the pinky** — *clearly curled*. Any finger landing in the dead
//! zone (ambiguous), the index not extended, or the pinky not curled yields
//! [`ChordQuality::Unknown`] ("no clear finger-count this frame"). Requiring a
//! clean pattern means a half-formed hand never silently flips the chord quality.
//!
//! ## Holding vs. decaying (differs from `gesture.rs`)
//!
//! Chord quality is a *selection* (like the hovered hex cell), not a momentary
//! modifier like palm-mute. So an `Unknown` frame — an ambiguous hand, or a lost
//! hand producing an invalid slice — **holds** the last committed quality rather
//! than decaying it; only a *different* clear quality that persists `hold_frames`
//! consecutive frames replaces it. The caller calls [`FingerCountCore::reset`]
//! (back to [`DEFAULT_QUALITY`]) when the chord hand is lost, mirroring the
//! hexmap selector's "non-finite sample keeps the held cell; reset on tracking
//! loss" rule (ADR-0010).

use crate::gesture::{
    finger_extended, landmarks_valid, INDEX_FINGER, MIDDLE_FINGER, PINKY_FINGER, RING_FINGER,
};
use wasm_bindgen::prelude::*;

/// A chord quality selected by the left hand's extended-finger count (PRD §6.2).
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChordQuality {
    /// No clear finger-count gesture this frame (ambiguous hand / no hand).
    /// The stateful detector holds its last quality through these.
    Unknown,
    /// Index finger only → major triad.
    Major,
    /// Index + middle → minor triad.
    Minor,
    /// Index + middle + ring → dominant 7th (stretch goal).
    Dominant7,
}

/// The quality a freshly-created / just-reset detector reports before any clear
/// gesture: a plain major, the natural default when a hex is hovered.
pub const DEFAULT_QUALITY: ChordQuality = ChordQuality::Major;

/// Default debounce: consecutive frames a new quality must hold before it is
/// committed. Matches [`crate::gesture::DEFAULT_HOLD_FRAMES`].
pub const DEFAULT_HOLD_FRAMES: u32 = 3;

/// Classify a single frame of landmarks into a [`ChordQuality`], stateless.
///
/// Returns [`ChordQuality::Unknown`] for wrong-length / non-finite input and for
/// any hand that is not one of the three clean finger-count patterns (see module
/// docs). Never panics.
pub fn classify_finger_count(landmarks: &[f64]) -> ChordQuality {
    if !landmarks_valid(landmarks) {
        return ChordQuality::Unknown;
    }

    let index = finger_extended(landmarks, INDEX_FINGER);
    let middle = finger_extended(landmarks, MIDDLE_FINGER);
    let ring = finger_extended(landmarks, RING_FINGER);
    let pinky = finger_extended(landmarks, PINKY_FINGER);

    match (index, middle, ring, pinky) {
        // Index only.
        (Some(true), Some(false), Some(false), Some(false)) => ChordQuality::Major,
        // Index + middle.
        (Some(true), Some(true), Some(false), Some(false)) => ChordQuality::Minor,
        // Index + middle + ring (pinky still curled).
        (Some(true), Some(true), Some(true), Some(false)) => ChordQuality::Dominant7,
        // Anything else — index curled, open palm, an ambiguous finger, a raised
        // pinky — is not a clean chord-quality gesture.
        _ => ChordQuality::Unknown,
    }
}

/// Pure core of the finger-count detector (wasm-free, per ADR-0002), holding the
/// debounce state. The exported [`FingerCountDetector`] is a thin wrapper.
#[derive(Clone, Debug)]
pub struct FingerCountCore {
    hold_frames: u32,
    committed: ChordQuality,
    candidate: ChordQuality,
    candidate_count: u32,
}

impl FingerCountCore {
    /// New detector starting at [`DEFAULT_QUALITY`]. `hold_frames` is how many
    /// consecutive frames a new quality must persist before committing; `0` is
    /// treated as `1` (commit immediately, no debounce).
    pub fn new(hold_frames: u32) -> Self {
        FingerCountCore {
            hold_frames: hold_frames.max(1),
            committed: DEFAULT_QUALITY,
            candidate: DEFAULT_QUALITY,
            candidate_count: 0,
        }
    }

    /// The currently committed (debounced) chord quality.
    pub fn current(&self) -> ChordQuality {
        self.committed
    }

    /// Feed one frame of landmarks and return the committed quality after the
    /// debounce. An [`ChordQuality::Unknown`] frame (ambiguous or lost hand)
    /// *holds* the committed quality rather than decaying it — only a different
    /// clear quality sustained for `hold_frames` frames replaces it.
    pub fn update(&mut self, landmarks: &[f64]) -> ChordQuality {
        let raw = classify_finger_count(landmarks);

        if raw == ChordQuality::Unknown || raw == self.committed {
            // No clear change (or already there): clear any half-formed switch.
            self.candidate = self.committed;
            self.candidate_count = 0;
        } else if raw == self.candidate {
            self.candidate_count += 1;
            if self.candidate_count >= self.hold_frames {
                self.committed = raw;
                self.candidate_count = 0;
            }
        } else {
            // A different clear quality than we were tracking — fresh count.
            self.candidate = raw;
            self.candidate_count = 1;
            if self.candidate_count >= self.hold_frames {
                self.committed = raw;
                self.candidate_count = 0;
            }
        }
        self.committed
    }

    /// Reset to [`DEFAULT_QUALITY`] with no pending candidate. Call when the chord
    /// hand is lost or leaves the chord zone.
    pub fn reset(&mut self) {
        self.committed = DEFAULT_QUALITY;
        self.candidate = DEFAULT_QUALITY;
        self.candidate_count = 0;
    }
}

/// WASM-exported finger-count detector. One instance tracks the left hand's chord
/// quality over time.
#[wasm_bindgen]
pub struct FingerCountDetector {
    inner: FingerCountCore,
}

#[wasm_bindgen]
impl FingerCountDetector {
    /// See [`FingerCountCore::new`]. Exposed to JS as
    /// `new FingerCountDetector(holdFrames)`.
    #[wasm_bindgen(constructor)]
    pub fn new(hold_frames: u32) -> FingerCountDetector {
        FingerCountDetector {
            inner: FingerCountCore::new(hold_frames),
        }
    }

    /// See [`FingerCountCore::update`]. `landmarks` is a `Float64Array` of 42
    /// interleaved `x, y` values (21 MediaPipe landmarks).
    pub fn update(&mut self, landmarks: &[f64]) -> ChordQuality {
        self.inner.update(landmarks)
    }

    /// See [`FingerCountCore::current`].
    #[wasm_bindgen(getter)]
    pub fn current(&self) -> ChordQuality {
        self.inner.current()
    }

    /// See [`FingerCountCore::reset`].
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// Stateless single-frame classification, exported for callers that want the raw
/// per-frame quality without the debounce. See [`classify_finger_count`].
#[wasm_bindgen(js_name = classifyChordQuality)]
pub fn classify_chord_quality(landmarks: &[f64]) -> ChordQuality {
    classify_finger_count(landmarks)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gesture::LANDMARK_COORDS;

    /// Finger bases (MCP x) for index, middle, ring, pinky, left→right.
    const FINGER_BASE_X: [f64; 4] = [0.30, 0.40, 0.50, 0.60];

    /// Build a 42-value landmark array from a per-finger extended flag
    /// ([index, middle, ring, pinky]); `true` = straight vertical finger (ratio
    /// ≈ 1), `false` = curled back toward the knuckle (ratio ≈ 0). Wrist + thumb
    /// are plausible but never participate in finger-count classification.
    fn hand(extended: [bool; 4]) -> Vec<f64> {
        let mut pts = [(0.45, 0.80); 21];
        // Thumb chain (ignored) off to the side.
        pts[1] = (0.25, 0.75);
        pts[2] = (0.20, 0.70);
        pts[3] = (0.17, 0.66);
        pts[4] = (0.14, 0.62);

        let fingers = [INDEX_FINGER, MIDDLE_FINGER, RING_FINGER, PINKY_FINGER];
        for (k, finger) in fingers.iter().enumerate() {
            let bx = FINGER_BASE_X[k];
            let [mcp, pip, dip, tip] = *finger;
            if extended[k] {
                pts[mcp] = (bx, 0.60);
                pts[pip] = (bx, 0.50);
                pts[dip] = (bx, 0.40);
                pts[tip] = (bx, 0.30);
            } else {
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
    fn index_only_is_major() {
        assert_eq!(
            classify_finger_count(&hand([true, false, false, false])),
            ChordQuality::Major
        );
    }

    #[test]
    fn index_and_middle_is_minor() {
        assert_eq!(
            classify_finger_count(&hand([true, true, false, false])),
            ChordQuality::Minor
        );
    }

    #[test]
    fn index_middle_ring_is_dominant7() {
        assert_eq!(
            classify_finger_count(&hand([true, true, true, false])),
            ChordQuality::Dominant7
        );
    }

    #[test]
    fn fist_is_unknown() {
        // No extended fingers → not a chord-quality gesture.
        assert_eq!(
            classify_finger_count(&hand([false, false, false, false])),
            ChordQuality::Unknown
        );
    }

    #[test]
    fn open_palm_is_unknown() {
        // All four extended: pinky up breaks every clean pattern.
        assert_eq!(
            classify_finger_count(&hand([true, true, true, true])),
            ChordQuality::Unknown
        );
    }

    #[test]
    fn index_plus_pinky_horns_is_unknown() {
        // A raised pinky is never part of a clean quality gesture.
        assert_eq!(
            classify_finger_count(&hand([true, false, false, true])),
            ChordQuality::Unknown
        );
        // Even with middle up (would-be minor) a raised pinky rejects it.
        assert_eq!(
            classify_finger_count(&hand([true, true, false, true])),
            ChordQuality::Unknown
        );
    }

    #[test]
    fn gap_patterns_are_unknown() {
        // Index + ring but no middle is not a contiguous run.
        assert_eq!(
            classify_finger_count(&hand([true, false, true, false])),
            ChordQuality::Unknown
        );
        // Middle only (index curled) is not a quality gesture.
        assert_eq!(
            classify_finger_count(&hand([false, true, false, false])),
            ChordQuality::Unknown
        );
    }

    #[test]
    fn wrong_length_input_is_unknown() {
        assert_eq!(classify_finger_count(&[]), ChordQuality::Unknown);
        assert_eq!(classify_finger_count(&[0.0; 10]), ChordQuality::Unknown);
        assert_eq!(classify_finger_count(&[0.0; 63]), ChordQuality::Unknown);
    }

    #[test]
    fn non_finite_input_is_unknown() {
        let mut h = hand([true, false, false, false]);
        h[16] = f64::NAN;
        assert_eq!(classify_finger_count(&h), ChordQuality::Unknown);
        let mut h = hand([true, true, false, false]);
        h[0] = f64::INFINITY;
        assert_eq!(classify_finger_count(&h), ChordQuality::Unknown);
    }

    #[test]
    fn classification_is_rotation_and_scale_invariant() {
        // Rotate + scale + translate a minor gesture; it must still read Minor.
        let h = hand([true, true, false, false]);
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
        assert_eq!(classify_finger_count(&t), ChordQuality::Minor);
    }

    #[test]
    fn detector_starts_at_default_major() {
        let d = FingerCountCore::new(3);
        assert_eq!(d.current(), ChordQuality::Major);
    }

    #[test]
    fn debounce_requires_hold_frames_to_commit() {
        let mut d = FingerCountCore::new(3);
        let minor = hand([true, true, false, false]);
        // Starts at Major; two minor frames aren't enough.
        assert_eq!(d.update(&minor), ChordQuality::Major);
        assert_eq!(d.update(&minor), ChordQuality::Major);
        // Third consecutive minor frame commits it.
        assert_eq!(d.update(&minor), ChordQuality::Minor);
    }

    #[test]
    fn debounce_rejects_single_noisy_frame() {
        let mut d = FingerCountCore::new(3);
        let major = hand([true, false, false, false]);
        let dom7 = hand([true, true, true, false]);
        // Already Major (the default); confirm a frame.
        assert_eq!(d.update(&major), ChordQuality::Major);
        // One stray dom7 frame must not flip it.
        assert_eq!(d.update(&dom7), ChordQuality::Major);
        assert_eq!(d.update(&major), ChordQuality::Major);
    }

    #[test]
    fn unknown_frame_holds_last_quality() {
        let mut d = FingerCountCore::new(2);
        let minor = hand([true, true, false, false]);
        d.update(&minor);
        assert_eq!(d.update(&minor), ChordQuality::Minor);
        // An ambiguous / lost-hand frame must NOT decay the quality (unlike the
        // gesture detector's Neutral decay): the chord keeps sounding minor.
        let empty: Vec<f64> = Vec::new();
        assert_eq!(d.update(&empty), ChordQuality::Minor);
        assert_eq!(d.update(&empty), ChordQuality::Minor);
        let fist = hand([false, false, false, false]); // classifies Unknown
        assert_eq!(d.update(&fist), ChordQuality::Minor);
    }

    #[test]
    fn switches_after_sustained_change() {
        let mut d = FingerCountCore::new(2);
        let minor = hand([true, true, false, false]);
        let dom7 = hand([true, true, true, false]);
        d.update(&minor);
        assert_eq!(d.update(&minor), ChordQuality::Minor);
        // Two sustained dom7 frames flip it.
        assert_eq!(d.update(&dom7), ChordQuality::Minor);
        assert_eq!(d.update(&dom7), ChordQuality::Dominant7);
    }

    #[test]
    fn hold_frames_zero_commits_immediately() {
        let mut d = FingerCountCore::new(0); // treated as 1
        let minor = hand([true, true, false, false]);
        assert_eq!(d.update(&minor), ChordQuality::Minor);
    }

    #[test]
    fn reset_returns_to_default_major() {
        let mut d = FingerCountCore::new(1);
        let dom7 = hand([true, true, true, false]);
        assert_eq!(d.update(&dom7), ChordQuality::Dominant7);
        d.reset();
        assert_eq!(d.current(), ChordQuality::Major);
    }
}
