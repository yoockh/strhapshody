/**
 * Chord shape data table → sounding note set (task 3.5 / PRD §6).
 *
 * The committed selection from the chord latch is a (root letter, quality)
 * pair: the root comes from the hovered hex cell (`HexMap.cellChord`, letters
 * A–G) and the quality from the finger-count detector (major / minor /
 * dominant-7th). This module turns that pair into the six-string note set a
 * strum actually plays, by looking up a **fret-position table** — one fret per
 * string in standard tuning, exactly like a guitar chord diagram — and
 * resolving each string to a frequency.
 *
 * Pure, unit-tested logic (ADR-0002): no Web Audio, no DOM. The thin `audio.ts`
 * wrapper's `setChord()` consumes the frequency array this produces; `main.ts`
 * calls that on a strum boundary (the commit) so moving the fretting hand only
 * changes the sound once the picking hand strums (task 3.4).
 *
 * ## Fret tables
 *
 * String index order matches `STRING_NOTE_NAMES` / the strum zone top→bottom:
 * `0 = low E (E2)`, `1 = A2`, `2 = D3`, `3 = G3`, `4 = B3`, `5 = high e (E4)`.
 * Each shape is six frets, same order; `MUTED` (-1) means the string is not
 * sounded (a muted/omitted string in the voicing). Shapes are the standard
 * open-position chords where one exists, and E-shape / A-shape barre chords
 * for the roots that have no natural open voicing (C/F/G minor, B major, …),
 * so every A–G major and minor — plus the stretch-goal dominant-7ths — maps to
 * a real, correctly-voiced guitar chord.
 */

import { midiToFrequency, noteToMidi } from "./notes.ts";

/** `ChordQuality` integer values — must match `engine/src/fingercount.rs`. */
export const QUALITY_UNKNOWN = 0;
export const QUALITY_MAJOR = 1;
export const QUALITY_MINOR = 2;
export const QUALITY_DOMINANT7 = 3;

/** Fret value marking a string that isn't sounded in a voicing. */
export const MUTED = -1;

/** A guitar voicing: one fret per string, index 0 = low E … 5 = high e. */
export type ChordShape = readonly [number, number, number, number, number, number];

/**
 * Open-string MIDI notes of a standard-tuned guitar, index 0 = low E (top of
 * the strum zone) → 5 = high e (bottom), matching `STRING_NOTE_NAMES`.
 */
export const OPEN_STRING_NOTES: readonly string[] = [
  "E2",
  "A2",
  "D3",
  "G3",
  "B3",
  "E4",
];

/** `OPEN_STRING_NOTES` resolved to MIDI numbers (all valid → no nulls). */
export const OPEN_STRING_MIDI: readonly number[] = OPEN_STRING_NOTES.map((n) => {
  const m = noteToMidi(n);
  if (m === null) throw new Error(`invalid open-string note: ${n}`);
  return m;
});

/** Standard major-chord shapes, keyed by root letter. */
const MAJOR_SHAPES: Readonly<Record<string, ChordShape>> = {
  A: [MUTED, 0, 2, 2, 2, 0],
  B: [MUTED, 2, 4, 4, 4, 2], // A-shape barre, 2nd fret
  C: [MUTED, 3, 2, 0, 1, 0],
  D: [MUTED, MUTED, 0, 2, 3, 2],
  E: [0, 2, 2, 1, 0, 0],
  F: [1, 3, 3, 2, 1, 1], // E-shape barre, 1st fret
  G: [3, 2, 0, 0, 0, 3],
};

/** Standard minor-chord shapes, keyed by root letter. */
const MINOR_SHAPES: Readonly<Record<string, ChordShape>> = {
  A: [MUTED, 0, 2, 2, 1, 0],
  B: [MUTED, 2, 4, 4, 3, 2], // A-shape minor barre, 2nd fret
  C: [MUTED, 3, 5, 5, 4, 3], // A-shape minor barre, 3rd fret
  D: [MUTED, MUTED, 0, 2, 3, 1],
  E: [0, 2, 2, 0, 0, 0],
  F: [1, 3, 3, 1, 1, 1], // E-shape minor barre, 1st fret
  G: [3, 5, 5, 3, 3, 3], // E-shape minor barre, 3rd fret
};

/** Standard dominant-7th shapes (stretch goal, PRD §6.2), keyed by root letter. */
const DOM7_SHAPES: Readonly<Record<string, ChordShape>> = {
  A: [MUTED, 0, 2, 0, 2, 0],
  B: [MUTED, 2, 1, 2, 0, 2],
  C: [MUTED, 3, 2, 3, 1, 0],
  D: [MUTED, MUTED, 0, 2, 1, 2],
  E: [0, 2, 0, 1, 0, 0],
  F: [1, 3, 1, 2, 1, 1], // E-shape 7 barre, 1st fret
  G: [3, 2, 0, 0, 0, 1],
};

/**
 * The fret-position shape for a (root letter, quality) pair, or `null` if the
 * root isn't a known A–G letter. An `Unknown`/unrecognised quality falls back
 * to the major shape (the natural default; the latch never commits `Unknown`,
 * but this keeps the function total).
 */
export function chordShape(
  root: string | null | undefined,
  quality: number,
): ChordShape | null {
  if (!root) return null;
  const letter = root.trim().toUpperCase();
  const table =
    quality === QUALITY_MINOR
      ? MINOR_SHAPES
      : quality === QUALITY_DOMINANT7
        ? DOM7_SHAPES
        : MAJOR_SHAPES;
  return table[letter] ?? null;
}

/**
 * The six per-string frequencies (Hz) a strum of this chord plays, index
 * 0 = low E … 5 = high e. A muted string, or an unknown root, yields `0` for
 * that string — the audio engine treats a non-positive frequency as "don't
 * sound this string", so muted strings stay silent. Returns all-zero for an
 * unknown root so a bad lookup never throws in the render loop.
 */
export function chordFrequencies(
  root: string | null | undefined,
  quality: number,
): number[] {
  const shape = chordShape(root, quality);
  const freqs = new Array<number>(OPEN_STRING_MIDI.length).fill(0);
  if (!shape) return freqs;
  for (let i = 0; i < OPEN_STRING_MIDI.length; i++) {
    const fret = shape[i]!;
    if (fret < 0) continue; // muted / not sounded
    freqs[i] = midiToFrequency(OPEN_STRING_MIDI[i]! + fret);
  }
  return freqs;
}
