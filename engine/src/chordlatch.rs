//! "Chord changes only between strums" latch (task 3.4 / PRD §6).
//!
//! The left hand selects a chord continuously: the hovered hex cell gives the
//! chord *root* (see [`crate::hexmap`]) and the extended-finger count gives the
//! chord *quality* (see [`crate::fingercount`]). But a guitarist's chord does
//! not change the instant the fretting hand moves — it changes when the picking
//! hand next strikes the strings. So the *sounding* chord must update only at a
//! **strum boundary**, never mid-ring while a chord is still ringing out.
//!
//! This module is that latch. It is pure, deterministic Rust (ADR-0002): it is
//! fed the live selection each frame and told when a strum happens, and it is
//! fully `cargo test`-able with no camera or human.
//!
//! ## Two layers: pending vs. committed
//!
//! - **pending** — the live selection, updated every frame from the hovered hex
//!   cell + finger-count quality. This is "what the left hand is currently
//!   pointing at".
//! - **committed** — the *sounding* chord, i.e. what a strum right now would
//!   play. It only changes when [`ChordLatchCore::commit`] is called, which the
//!   frontend does at a strum boundary (before triggering the pluck voices, so
//!   the strum that armed the change also sounds it).
//!
//! ## Holding rules (match ADR-0010 / ADR-0011)
//!
//! - A **negative pending root** (`root < 0`, i.e. the cursor is outside the
//!   flower this frame) *keeps* the last valid pending root rather than clearing
//!   it. A transient off-flower frame must not arm a silent "no chord" strum —
//!   mirrors the hexmap selector holding its cell on a non-finite sample.
//! - An **`Unknown` pending quality** is likewise ignored (the finger-count
//!   detector already holds-last on `Unknown`, but the stateless classifier can
//!   emit it): keep the last pending quality.
//! - The committed chord **persists** across tracking loss — the frontend does
//!   NOT reset the latch per-frame when the chord hand disappears, so a brief
//!   dropout can't drop the chord that's ringing. [`ChordLatchCore::reset`] is a
//!   full clear for app reset / tests only.

use crate::fingercount::{ChordQuality, DEFAULT_QUALITY};
use wasm_bindgen::prelude::*;

/// Sentinel root meaning "no chord selected" (cursor has never been in a cell).
pub const NO_ROOT: i32 = -1;

/// Pure core of the chord latch (wasm-free, per ADR-0002). The exported
/// [`ChordLatch`] is a thin wrapper.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChordLatchCore {
    pending_root: i32,
    pending_quality: ChordQuality,
    committed_root: i32,
    committed_quality: ChordQuality,
}

impl Default for ChordLatchCore {
    fn default() -> Self {
        ChordLatchCore {
            pending_root: NO_ROOT,
            pending_quality: DEFAULT_QUALITY,
            committed_root: NO_ROOT,
            committed_quality: DEFAULT_QUALITY,
        }
    }
}

impl ChordLatchCore {
    /// New latch with nothing selected and the default (major) quality.
    pub fn new() -> Self {
        Self::default()
    }

    /// Update the live (pending) selection from the hovered hex cell + quality.
    ///
    /// A negative `root` keeps the last valid pending root (see module docs); an
    /// `Unknown` quality keeps the last pending quality. Does not touch the
    /// committed/sounding chord.
    pub fn set_pending(&mut self, root: i32, quality: ChordQuality) {
        if root >= 0 {
            self.pending_root = root;
        }
        if quality != ChordQuality::Unknown {
            self.pending_quality = quality;
        }
    }

    /// Commit the pending selection to the sounding chord — called at a strum
    /// boundary. Returns `true` if the sounding chord actually changed.
    pub fn commit(&mut self) -> bool {
        let changed = self.pending_root != self.committed_root
            || self.pending_quality != self.committed_quality;
        self.committed_root = self.pending_root;
        self.committed_quality = self.pending_quality;
        changed
    }

    /// The sounding chord's root cell index (`NO_ROOT` == none).
    pub fn committed_root(&self) -> i32 {
        self.committed_root
    }

    /// The sounding chord's quality.
    pub fn committed_quality(&self) -> ChordQuality {
        self.committed_quality
    }

    /// The live (not-yet-sounding) selection's root cell index.
    pub fn pending_root(&self) -> i32 {
        self.pending_root
    }

    /// The live (not-yet-sounding) selection's quality.
    pub fn pending_quality(&self) -> ChordQuality {
        self.pending_quality
    }

    /// Full clear — both pending and committed back to "no chord"/major. For app
    /// reset or tests; NOT called per-frame on tracking loss (the committed chord
    /// must persist through a brief dropout).
    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

/// WASM-exported chord latch. One instance holds the sounding chord for the whole
/// app; the frontend feeds it the live selection each frame and commits it on a
/// strum boundary.
#[wasm_bindgen]
pub struct ChordLatch {
    inner: ChordLatchCore,
}

impl Default for ChordLatch {
    fn default() -> Self {
        ChordLatch::new()
    }
}

#[wasm_bindgen]
impl ChordLatch {
    /// See [`ChordLatchCore::new`]. Exposed to JS as `new ChordLatch()`.
    #[wasm_bindgen(constructor)]
    pub fn new() -> ChordLatch {
        ChordLatch {
            inner: ChordLatchCore::new(),
        }
    }

    /// See [`ChordLatchCore::set_pending`]. `root` is the hovered hex cell index
    /// (`-1` for none), `quality` the finger-count quality.
    #[wasm_bindgen(js_name = setPending)]
    pub fn set_pending(&mut self, root: i32, quality: ChordQuality) {
        self.inner.set_pending(root, quality);
    }

    /// See [`ChordLatchCore::commit`]. Returns whether the sounding chord changed.
    pub fn commit(&mut self) -> bool {
        self.inner.commit()
    }

    /// See [`ChordLatchCore::committed_root`].
    #[wasm_bindgen(getter, js_name = committedRoot)]
    pub fn committed_root(&self) -> i32 {
        self.inner.committed_root()
    }

    /// See [`ChordLatchCore::committed_quality`].
    #[wasm_bindgen(getter, js_name = committedQuality)]
    pub fn committed_quality(&self) -> ChordQuality {
        self.inner.committed_quality()
    }

    /// See [`ChordLatchCore::pending_root`].
    #[wasm_bindgen(getter, js_name = pendingRoot)]
    pub fn pending_root(&self) -> i32 {
        self.inner.pending_root()
    }

    /// See [`ChordLatchCore::pending_quality`].
    #[wasm_bindgen(getter, js_name = pendingQuality)]
    pub fn pending_quality(&self) -> ChordQuality {
        self.inner.pending_quality()
    }

    /// See [`ChordLatchCore::reset`].
    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn starts_empty_with_default_quality() {
        let l = ChordLatchCore::new();
        assert_eq!(l.committed_root(), NO_ROOT);
        assert_eq!(l.committed_quality(), ChordQuality::Major);
        assert_eq!(l.pending_root(), NO_ROOT);
        assert_eq!(l.pending_quality(), ChordQuality::Major);
    }

    #[test]
    fn pending_updates_do_not_touch_committed() {
        let mut l = ChordLatchCore::new();
        l.set_pending(2, ChordQuality::Minor);
        // The live selection moved, but nothing has sounded yet.
        assert_eq!(l.pending_root(), 2);
        assert_eq!(l.pending_quality(), ChordQuality::Minor);
        assert_eq!(l.committed_root(), NO_ROOT);
        assert_eq!(l.committed_quality(), ChordQuality::Major);
    }

    #[test]
    fn commit_moves_pending_into_committed() {
        let mut l = ChordLatchCore::new();
        l.set_pending(3, ChordQuality::Minor);
        assert!(l.commit()); // changed (was none/major)
        assert_eq!(l.committed_root(), 3);
        assert_eq!(l.committed_quality(), ChordQuality::Minor);
    }

    #[test]
    fn chord_only_changes_on_commit_never_mid_ring() {
        let mut l = ChordLatchCore::new();
        // Strum an A-minor (say cell 3, minor).
        l.set_pending(3, ChordQuality::Minor);
        l.commit();
        assert_eq!(l.committed_root(), 3);
        assert_eq!(l.committed_quality(), ChordQuality::Minor);

        // Now the left hand roams across several cells/qualities while the chord
        // is still ringing — the sounding chord must NOT follow it mid-ring.
        l.set_pending(1, ChordQuality::Major);
        l.set_pending(5, ChordQuality::Dominant7);
        l.set_pending(0, ChordQuality::Major);
        assert_eq!(l.committed_root(), 3);
        assert_eq!(l.committed_quality(), ChordQuality::Minor);

        // Only the next strum adopts wherever the hand ended up.
        assert!(l.commit());
        assert_eq!(l.committed_root(), 0);
        assert_eq!(l.committed_quality(), ChordQuality::Major);
    }

    #[test]
    fn commit_reports_unchanged_when_selection_is_the_same() {
        let mut l = ChordLatchCore::new();
        l.set_pending(4, ChordQuality::Major);
        assert!(l.commit()); // none/major -> 4/major is a change
        // Re-strumming the same chord: committed is identical, so no change.
        assert!(!l.commit());
        l.set_pending(4, ChordQuality::Major);
        assert!(!l.commit());
    }

    #[test]
    fn negative_root_holds_last_valid_pending_root() {
        let mut l = ChordLatchCore::new();
        l.set_pending(2, ChordQuality::Minor);
        // Cursor briefly leaves the flower (root -1) but quality still reads.
        l.set_pending(NO_ROOT, ChordQuality::Major);
        assert_eq!(l.pending_root(), 2); // held, not cleared
        assert_eq!(l.pending_quality(), ChordQuality::Major); // quality did update
        // A strum now sounds the held root, not "no chord".
        l.commit();
        assert_eq!(l.committed_root(), 2);
        assert_eq!(l.committed_quality(), ChordQuality::Major);
    }

    #[test]
    fn unknown_quality_holds_last_pending_quality() {
        let mut l = ChordLatchCore::new();
        l.set_pending(1, ChordQuality::Dominant7);
        // An ambiguous finger-count frame must not wipe the quality.
        l.set_pending(1, ChordQuality::Unknown);
        assert_eq!(l.pending_quality(), ChordQuality::Dominant7);
        l.commit();
        assert_eq!(l.committed_quality(), ChordQuality::Dominant7);
    }

    #[test]
    fn committed_chord_persists_without_a_reset() {
        // Simulates a brief chord-hand dropout: the frontend simply stops feeding
        // set_pending and never resets, so the ringing chord survives.
        let mut l = ChordLatchCore::new();
        l.set_pending(5, ChordQuality::Minor);
        l.commit();
        // ... many frames with no set_pending / no commit ...
        assert_eq!(l.committed_root(), 5);
        assert_eq!(l.committed_quality(), ChordQuality::Minor);
    }

    #[test]
    fn reset_fully_clears_both_layers() {
        let mut l = ChordLatchCore::new();
        l.set_pending(3, ChordQuality::Dominant7);
        l.commit();
        l.set_pending(6, ChordQuality::Minor);
        l.reset();
        assert_eq!(l.committed_root(), NO_ROOT);
        assert_eq!(l.committed_quality(), ChordQuality::Major);
        assert_eq!(l.pending_root(), NO_ROOT);
        assert_eq!(l.pending_quality(), ChordQuality::Major);
    }

    #[test]
    fn quality_only_change_is_a_change_on_commit() {
        let mut l = ChordLatchCore::new();
        l.set_pending(2, ChordQuality::Major);
        l.commit();
        // Same root, different quality (e.g. raised the middle finger, then strum).
        l.set_pending(2, ChordQuality::Minor);
        assert!(l.commit());
        assert_eq!(l.committed_root(), 2);
        assert_eq!(l.committed_quality(), ChordQuality::Minor);
    }
}
