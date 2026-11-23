/**
 * Sounding-voicing selection (task 4.3 / PRD §6–7).
 *
 * At every strum boundary the app decides which six-string note set the audio
 * engine should hold: either the latched hex chord (Chord mode, task 3.5) or a
 * power chord picked on the strip (Power mode). This module turns either
 * selection into a `Voicing` — six per-string frequencies, a stable identity
 * `key` (so the caller only reloads the engine when the voicing actually
 * changes) and the status-bar `label`.
 *
 * ## Power chords
 *
 * A power chord is the root plus its fifth, optionally the octave (PRD §7). The
 * engine's `powerstrip` module (ADR-0013) decides *which strings* carry the
 * root / fifth / octave and the *fret* under the cursor; everything that turns
 * that into pitches and names lives here, in TypeScript, per ADR-0013 §4:
 *
 * - root  = open-string MIDI of the root string + fret;
 * - fifth = root + 7 semitones, octave = root + 12, each placed on its string
 *   at whatever fret yields that pitch (in standard tuning that's `fret + 2`
 *   for both the E/A and A/D pairs, but it's derived, not hard-coded);
 * - every other string gets `0` Hz. The audio engine treats a non-positive
 *   frequency as "don't sound this string" (ADR-0009), so the right hand's
 *   strum only rings the 2 (or 3) power-chord strings — the restriction in
 *   task 4.3 falls out of the note set, with no special-casing in the strum
 *   path.
 *
 * Label format follows PRD §7: `"G5 (fret 3, low E)"`.
 *
 * Pure, node-testable (ADR-0002): no Web Audio, no wasm import — string indices
 * from the engine are passed in as plain numbers.
 */

import { chordLabel } from "./chord.ts";
import { chordFrequencies, OPEN_STRING_MIDI } from "./chords.ts";
import { midiToFrequency, midiToPitchClass } from "./notes.ts";
import { STRING_NOTE_NAMES } from "./strings.ts";

/** Semitones above the root for the fifth and the octave. */
const FIFTH_SEMITONES = 7;
const OCTAVE_SEMITONES = 12;

/** Highest fret a derived fifth/octave may land on (a 24-fret neck). */
export const MAX_NECK_FRET = 24;

/** A note set ready for `AudioEngine.setChord`, plus its identity and label. */
export interface Voicing {
  /** Stable identity; equal keys ⇒ identical note sets (skip the reload). */
  readonly key: string;
  /** Status-bar text, e.g. `"Am"` or `"G5 (fret 3, low E)"`. */
  readonly label: string;
  /** Six frequencies (Hz), index 0 = low E … 5 = high e; `0` = silent string. */
  readonly frequencies: readonly number[];
}

/** A power-chord selection: fret plus the string indices the engine chose. */
export interface PowerSelection {
  /** Fret of the root on the root string (0 = open). */
  readonly fret: number;
  /** String index carrying the root (0 = low E). */
  readonly rootString: number;
  /** String index carrying the fifth. */
  readonly fifthString: number;
  /** String index carrying the optional octave. */
  readonly octaveString: number;
}

/** A hex-chord selection: root letter (A–G) and `ChordQuality` integer. */
export interface ChordSelection {
  readonly root: string | null;
  readonly quality: number;
}

/**
 * Human name for a string index in labels: `0` → "low E", `5` → "high e",
 * otherwise the open-string letter ("A", "D", "G", "B"). Out of range → "?".
 */
export function stringLabel(index: number): string {
  if (index === 0) return "low E";
  if (index === STRING_NOTE_NAMES.length - 1) return "high e";
  return STRING_NOTE_NAMES[index] ?? "?";
}

function validString(index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < OPEN_STRING_MIDI.length;
}

/**
 * Fret on `string` that sounds `midi`, or `null` if that pitch isn't reachable
 * on that string (below the open string or above `MAX_NECK_FRET`).
 */
function fretFor(string: number, midi: number): number | null {
  const fret = midi - OPEN_STRING_MIDI[string]!;
  return fret >= 0 && fret <= MAX_NECK_FRET ? fret : null;
}

/** The power chord's display name, e.g. `"G5 (fret 3, low E)"`; `null` if invalid. */
export function powerChordLabel(fret: number, rootString: number): string | null {
  if (!validString(rootString) || !Number.isInteger(fret) || fret < 0) return null;
  const name = midiToPitchClass(OPEN_STRING_MIDI[rootString]! + fret);
  if (name === null) return null;
  return `${name}5 (fret ${fret}, ${stringLabel(rootString)})`;
}

/**
 * Build the power-chord voicing: root + fifth (+ octave when `withOctave`) on
 * their strings, every other string silent. Returns `null` for an invalid
 * selection (negative / non-integer fret, out-of-range root string) so the
 * caller keeps whatever was sounding. A fifth/octave string that's invalid, or
 * that can't reach the pitch, is simply left silent rather than failing the
 * whole chord.
 */
export function powerVoicing(sel: PowerSelection, withOctave: boolean): Voicing | null {
  const label = powerChordLabel(sel.fret, sel.rootString);
  if (label === null) return null;

  const freqs = new Array<number>(OPEN_STRING_MIDI.length).fill(0);
  const rootMidi = OPEN_STRING_MIDI[sel.rootString]! + sel.fret;
  freqs[sel.rootString] = midiToFrequency(rootMidi);

  const place = (string: number, midi: number): void => {
    if (!validString(string) || string === sel.rootString) return;
    if (fretFor(string, midi) === null) return;
    freqs[string] = midiToFrequency(midi);
  };
  place(sel.fifthString, rootMidi + FIFTH_SEMITONES);
  if (withOctave) place(sel.octaveString, rootMidi + OCTAVE_SEMITONES);

  return {
    key: `power:${sel.rootString}:${sel.fret}:${withOctave ? 1 : 0}`,
    label,
    frequencies: freqs,
  };
}

/**
 * Build the hex-chord voicing from the chord tables (task 3.5). Returns `null`
 * when nothing valid has been committed yet (no root, or not an A–G letter),
 * so the engine keeps its default note set instead of going silent.
 */
export function chordVoicing(sel: ChordSelection): Voicing | null {
  if (!sel.root) return null;
  const letter = sel.root.trim().toUpperCase();
  const freqs = chordFrequencies(letter, sel.quality);
  if (freqs.every((f) => f <= 0)) return null;
  return {
    key: `chord:${letter}:${sel.quality}`,
    label: chordLabel(letter, sel.quality),
    frequencies: freqs,
  };
}

/**
 * Pick the voicing a strum should sound: the power chord when in Power mode
 * with a valid power selection, otherwise the latched hex chord. `null` means
 * "nothing new to load — keep the current note set".
 */
export function selectVoicing(
  mode: "Chord" | "Power",
  power: PowerSelection | null,
  chord: ChordSelection,
  withOctave: boolean,
): Voicing | null {
  if (mode === "Power" && power) {
    const v = powerVoicing(power, withOctave);
    if (v) return v;
  }
  return chordVoicing(chord);
}
