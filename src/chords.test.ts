import { describe, it, expect } from "vitest";
import {
  chordShape,
  chordFrequencies,
  OPEN_STRING_MIDI,
  OPEN_STRING_NOTES,
  MUTED,
  QUALITY_MAJOR,
  QUALITY_MINOR,
  QUALITY_DOMINANT7,
  QUALITY_UNKNOWN,
} from "./chords.ts";
import { noteToMidi, midiToFrequency } from "./notes.ts";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G"] as const;

/** Pitch class (0–11) of a chord tone spelled from a letter + accidental. */
function pc(name: string): number {
  const m = noteToMidi(`${name}0`);
  if (m === null) throw new Error(`bad note ${name}`);
  return ((m % 12) + 12) % 12;
}

/** The expected pitch-class set for a (root, quality) triad/7th. */
function expectedPitchClasses(root: string, quality: number): Set<number> {
  const r = pc(root);
  const third = quality === QUALITY_MINOR ? 3 : 4;
  const set = new Set([r, (r + third) % 12, (r + 7) % 12]);
  if (quality === QUALITY_DOMINANT7) set.add((r + 10) % 12);
  return set;
}

/** Sounded (non-muted) MIDI notes a shape produces. */
function soundedMidi(root: string, quality: number): number[] {
  const shape = chordShape(root, quality)!;
  const out: number[] = [];
  for (let i = 0; i < shape.length; i++) {
    const fret = shape[i]!;
    if (fret >= 0) out.push(OPEN_STRING_MIDI[i]! + fret);
  }
  return out;
}

describe("open-string reference", () => {
  it("has six strings matching STRING_NOTE_NAMES order (low E → high e)", () => {
    expect(OPEN_STRING_NOTES).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    expect(OPEN_STRING_MIDI).toEqual([40, 45, 50, 55, 59, 64]);
  });
});

describe("chordShape lookup", () => {
  it("returns a six-fret shape for every A–G letter in all qualities", () => {
    for (const root of LETTERS) {
      for (const q of [QUALITY_MAJOR, QUALITY_MINOR, QUALITY_DOMINANT7]) {
        const shape = chordShape(root, q);
        expect(shape, `${root} q=${q}`).not.toBeNull();
        expect(shape!.length).toBe(6);
      }
    }
  });

  it("is case-insensitive and trims whitespace on the root", () => {
    expect(chordShape(" c ", QUALITY_MAJOR)).toEqual(chordShape("C", QUALITY_MAJOR));
    expect(chordShape("g", QUALITY_MINOR)).toEqual(chordShape("G", QUALITY_MINOR));
  });

  it("returns null for an unknown / empty root", () => {
    expect(chordShape("H", QUALITY_MAJOR)).toBeNull();
    expect(chordShape("", QUALITY_MAJOR)).toBeNull();
    expect(chordShape(null, QUALITY_MAJOR)).toBeNull();
    expect(chordShape(undefined, QUALITY_MAJOR)).toBeNull();
  });

  it("falls back to the major shape for an Unknown quality", () => {
    expect(chordShape("D", QUALITY_UNKNOWN)).toEqual(chordShape("D", QUALITY_MAJOR));
  });

  it("major and minor of the same root differ (the third moves)", () => {
    for (const root of LETTERS) {
      expect(chordShape(root, QUALITY_MAJOR)).not.toEqual(
        chordShape(root, QUALITY_MINOR),
      );
    }
  });
});

describe("chord voicings are harmonically correct", () => {
  it("every major shape sounds only notes from the major triad, and contains the root", () => {
    for (const root of LETTERS) {
      const expected = expectedPitchClasses(root, QUALITY_MAJOR);
      const notes = soundedMidi(root, QUALITY_MAJOR);
      expect(notes.length, `${root} major voiced strings`).toBeGreaterThanOrEqual(3);
      const classes = new Set(notes.map((n) => n % 12));
      for (const c of classes) expect(expected.has(c), `${root}M note pc ${c}`).toBe(true);
      expect(classes.has(pc(root)), `${root}M has root`).toBe(true);
    }
  });

  it("every minor shape sounds only notes from the minor triad, and contains the root", () => {
    for (const root of LETTERS) {
      const expected = expectedPitchClasses(root, QUALITY_MINOR);
      const notes = soundedMidi(root, QUALITY_MINOR);
      expect(notes.length, `${root} minor voiced strings`).toBeGreaterThanOrEqual(3);
      const classes = new Set(notes.map((n) => n % 12));
      for (const c of classes) expect(expected.has(c), `${root}m note pc ${c}`).toBe(true);
      expect(classes.has(pc(root)), `${root}m has root`).toBe(true);
      // The minor third (not the major third) must be present.
      expect(classes.has((pc(root) + 3) % 12), `${root}m has minor 3rd`).toBe(true);
    }
  });

  it("every dominant-7th shape sounds only chord tones and contains root + flat-7", () => {
    for (const root of LETTERS) {
      const expected = expectedPitchClasses(root, QUALITY_DOMINANT7);
      const notes = soundedMidi(root, QUALITY_DOMINANT7);
      const classes = new Set(notes.map((n) => n % 12));
      for (const c of classes) expect(expected.has(c), `${root}7 note pc ${c}`).toBe(true);
      expect(classes.has(pc(root)), `${root}7 has root`).toBe(true);
      expect(classes.has((pc(root) + 10) % 12), `${root}7 has b7`).toBe(true);
    }
  });

  it("C major is the classic x-3-2-0-1-0 open voicing", () => {
    expect(chordShape("C", QUALITY_MAJOR)).toEqual([MUTED, 3, 2, 0, 1, 0]);
    // C E G C E → pitch classes {C,E,G}
    const classes = new Set(soundedMidi("C", QUALITY_MAJOR).map((n) => n % 12));
    expect(classes).toEqual(new Set([pc("C"), pc("E"), pc("G")]));
  });
});

describe("chordFrequencies", () => {
  it("returns six entries, 0 for muted strings, frequency for sounded ones", () => {
    const freqs = chordFrequencies("C", QUALITY_MAJOR);
    expect(freqs.length).toBe(6);
    // Low E is muted in the C shape → 0; the others sound.
    expect(freqs[0]).toBe(0);
    for (let i = 1; i < 6; i++) expect(freqs[i]).toBeGreaterThan(0);
  });

  it("matches the open-string-plus-fret frequency exactly", () => {
    // D major: x x 0 2 3 2 → string 2 (D3) open = 50, string 3 (G3)+2 = 57, etc.
    const freqs = chordFrequencies("D", QUALITY_MAJOR);
    expect(freqs[0]).toBe(0);
    expect(freqs[1]).toBe(0);
    expect(freqs[2]).toBeCloseTo(midiToFrequency(50), 6); // D3 open
    expect(freqs[3]).toBeCloseTo(midiToFrequency(57), 6); // G3 + 2 = A3
    expect(freqs[4]).toBeCloseTo(midiToFrequency(62), 6); // B3 + 3 = D4
    expect(freqs[5]).toBeCloseTo(midiToFrequency(66), 6); // E4 + 2 = F#4
  });

  it("returns all-zero for an unknown root instead of throwing", () => {
    expect(chordFrequencies("H", QUALITY_MAJOR)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(chordFrequencies(null, QUALITY_MAJOR)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("A minor differs audibly from A major (the third is a semitone lower)", () => {
    const maj = chordFrequencies("A", QUALITY_MAJOR);
    const min = chordFrequencies("A", QUALITY_MINOR);
    expect(maj).not.toEqual(min);
  });
});
