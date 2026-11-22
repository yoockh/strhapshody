/**
 * Chord-label formatting for the status bar (task 3.4).
 *
 * Pure, unit-tested display glue: turns a root letter (from the hex flower,
 * `HexMap.cellChord`) plus a chord quality (from the finger-count detector /
 * chord latch) into a human-readable label like `C`, `Cm`, `C7`.
 *
 * Quality is passed as its integer value so a committed quality straight out of
 * the WASM `ChordLatch` (`committedQuality`) can be handed through without
 * importing the wasm module into this pure, node-testable file. The values match
 * the engine's `ChordQuality` enum exactly (see `engine/src/fingercount.rs`):
 * `Unknown = 0, Major = 1, Minor = 2, Dominant7 = 3`.
 */

/** Placeholder shown when no chord has been committed (sounded) yet. */
export const NO_CHORD_LABEL = "—";

/**
 * Display suffix per `ChordQuality` integer value. Major (and the should-never-
 * display Unknown) add nothing; minor adds `m`; dominant-7th adds `7`.
 */
export const QUALITY_SUFFIX: Readonly<Record<number, string>> = {
  0: "", // Unknown — never expected at the display layer; render as plain root.
  1: "", // Major
  2: "m", // Minor
  3: "7", // Dominant7
};

/** Suffix for a chord quality value; unknown values render as no suffix. */
export function qualitySuffix(quality: number): string {
  return QUALITY_SUFFIX[quality] ?? "";
}

/**
 * Build the status-bar chord label. `root` is the root letter (e.g. `"C"`), or
 * `null`/empty when nothing is selected yet → the em-dash placeholder.
 */
export function chordLabel(root: string | null | undefined, quality: number): string {
  if (!root) return NO_CHORD_LABEL;
  return root + qualitySuffix(quality);
}
