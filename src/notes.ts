/**
 * Musical note → frequency math (task 2.4).
 *
 * Pure, unit-tested logic (ADR-0002): parsing scientific-pitch-notation note
 * names ("E2", "A#3", "Bb3", "e4") into frequencies in Hz, plus the single
 * hardcoded "test chord" the audio skeleton plays until the real chord tables
 * arrive in Phase 3. No Web Audio / DOM here — that lives in the thin
 * `audio.ts` wrapper, which consumes these frequencies.
 *
 * Standard concert pitch: A4 = 440 Hz, equal temperament. The MIDI convention
 * (A4 = MIDI note 69) is used internally because it makes the semitone math a
 * single formula.
 */

/** Concert-pitch reference: MIDI note 69 (A4) = 440 Hz. */
export const A4_HZ = 440;
const A4_MIDI = 69;

/** Semitone offset above C for each natural pitch class. */
const PITCH_CLASS: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/**
 * Convert a MIDI note number to its frequency in Hz (equal temperament,
 * A4 = MIDI 69 = 440 Hz). Non-finite input → NaN is avoided by the callers
 * (`noteToFrequency` validates first); exposed for reuse by later phases.
 */
export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12);
}

/** Sharp-spelled pitch-class names, index = semitone above C. */
export const PITCH_CLASS_NAMES: readonly string[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

/**
 * Pitch-class name (no octave, sharp spelling) of a MIDI note: 67 → "G",
 * 46 → "A#". Non-integer input is rounded; non-finite → `null`. Negative MIDI
 * numbers wrap correctly (pitch class is taken modulo 12).
 */
export function midiToPitchClass(midi: number): string | null {
  if (!Number.isFinite(midi)) return null;
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  return PITCH_CLASS_NAMES[pc] ?? null;
}

/**
 * Parse a scientific-pitch-notation note name into a MIDI note number, or
 * `null` if it doesn't parse. Accepts an optional accidental (`#`/`s` sharp,
 * `b` flat) and a (possibly negative) octave, and is case-insensitive on the
 * letter so the high-E string's lowercase "e4" works too.
 *
 * Octave convention: C4 = middle C = MIDI 60, so A4 = MIDI 69 (440 Hz).
 */
export function noteToMidi(note: string): number | null {
  const m = /^([A-Ga-g])([#sb]?)(-?\d+)$/.exec(note.trim());
  if (!m) return null;

  const letter = m[1]!.toUpperCase();
  const accidental = m[2]!;
  const octave = Number.parseInt(m[3]!, 10);

  const base = PITCH_CLASS[letter];
  if (base === undefined || !Number.isFinite(octave)) return null;

  let semitone = base;
  if (accidental === "#" || accidental === "s") semitone += 1;
  else if (accidental === "b") semitone -= 1;

  // MIDI 0 = C-1, so MIDI = (octave + 1) * 12 + semitone-within-octave.
  return (octave + 1) * 12 + semitone;
}

/**
 * Frequency in Hz for a scientific-pitch-notation note name, or `null` if the
 * name can't be parsed. "E2" → 82.41 Hz, "A4" → 440, "e4" → 329.63.
 */
export function noteToFrequency(note: string): number | null {
  const midi = noteToMidi(note);
  return midi === null ? null : midiToFrequency(midi);
}

/**
 * The single hardcoded "test chord" the audio skeleton plays (task 2.4): the
 * six open strings of a standard-tuned guitar, index 0 → 5 == top → bottom of
 * the strum zone (low E at the top, high E at the bottom), matching
 * `STRING_NOTE_NAMES` in `strings.ts`. Strummed together these ring as an open
 * Em11-ish voicing — a real chord, good enough as a placeholder until the
 * Phase-3 chord tables drive the note set.
 */
export const TEST_CHORD_NOTES: readonly string[] = [
  "E2",
  "A2",
  "D3",
  "G3",
  "B3",
  "E4",
];

/**
 * `TEST_CHORD_NOTES` resolved to frequencies in Hz, in the same top→bottom
 * string order. Every name is valid, so no nulls escape here.
 */
export const TEST_CHORD_FREQUENCIES: readonly number[] = TEST_CHORD_NOTES.map(
  (n) => {
    const f = noteToFrequency(n);
    if (f === null) throw new Error(`invalid test-chord note: ${n}`);
    return f;
  },
);
