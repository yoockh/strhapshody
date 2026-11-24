import { describe, it, expect } from "vitest";
import {
  A4_HZ,
  midiToFrequency,
  midiToPitchClass,
  noteToMidi,
  noteToFrequency,
  TEST_CHORD_NOTES,
  TEST_CHORD_FREQUENCIES,
} from "./notes.ts";

describe("midiToFrequency", () => {
  it("maps the A4 reference (MIDI 69) to 440 Hz exactly", () => {
    expect(midiToFrequency(69)).toBeCloseTo(A4_HZ, 10);
  });

  it("is an octave (2x) apart for 12 semitones", () => {
    expect(midiToFrequency(69 + 12)).toBeCloseTo(880, 6);
    expect(midiToFrequency(69 - 12)).toBeCloseTo(220, 6);
  });
});

describe("noteToMidi", () => {
  it("places middle C (C4) at MIDI 60 and A4 at 69", () => {
    expect(noteToMidi("C4")).toBe(60);
    expect(noteToMidi("A4")).toBe(69);
  });

  it("handles sharps and flats (including the 's' sharp alias)", () => {
    expect(noteToMidi("A#4")).toBe(70);
    expect(noteToMidi("As4")).toBe(70);
    expect(noteToMidi("Bb4")).toBe(70); // enharmonic with A#4
    expect(noteToMidi("Cb4")).toBe(noteToMidi("B3"));
  });

  it("is case-insensitive on the letter (high-E string 'e')", () => {
    expect(noteToMidi("e4")).toBe(noteToMidi("E4"));
    expect(noteToMidi("g3")).toBe(noteToMidi("G3"));
  });

  it("supports negative octaves (C-1 = MIDI 0)", () => {
    expect(noteToMidi("C-1")).toBe(0);
  });

  it("returns null for anything that doesn't parse", () => {
    expect(noteToMidi("H2")).toBeNull(); // no H note
    expect(noteToMidi("xyz")).toBeNull();
    expect(noteToMidi("E")).toBeNull(); // missing octave
    expect(noteToMidi("")).toBeNull();
    expect(noteToMidi("4")).toBeNull();
    expect(noteToMidi("E##2")).toBeNull(); // only one accidental supported
  });

  it("tolerates surrounding whitespace", () => {
    expect(noteToMidi("  A4 ")).toBe(69);
  });
});

describe("noteToFrequency", () => {
  it("resolves the standard guitar open strings to their known pitches", () => {
    expect(noteToFrequency("E2")!).toBeCloseTo(82.41, 1);
    expect(noteToFrequency("A2")!).toBeCloseTo(110, 2);
    expect(noteToFrequency("D3")!).toBeCloseTo(146.83, 1);
    expect(noteToFrequency("G3")!).toBeCloseTo(196, 1);
    expect(noteToFrequency("B3")!).toBeCloseTo(246.94, 1);
    expect(noteToFrequency("E4")!).toBeCloseTo(329.63, 1);
  });

  it("returns null for an unparseable name", () => {
    expect(noteToFrequency("nope")).toBeNull();
  });
});

describe("TEST_CHORD", () => {
  it("has six notes, one per string", () => {
    expect(TEST_CHORD_NOTES).toHaveLength(6);
    expect(TEST_CHORD_FREQUENCIES).toHaveLength(6);
  });

  it("is the open-string set, strictly ascending in pitch top→bottom", () => {
    expect([...TEST_CHORD_NOTES]).toEqual(["E2", "A2", "D3", "G3", "B3", "E4"]);
    for (let i = 1; i < TEST_CHORD_FREQUENCIES.length; i++) {
      expect(TEST_CHORD_FREQUENCIES[i]!).toBeGreaterThan(
        TEST_CHORD_FREQUENCIES[i - 1]!,
      );
    }
  });

  it("resolves each note name to its frequency", () => {
    for (let i = 0; i < TEST_CHORD_NOTES.length; i++) {
      expect(TEST_CHORD_FREQUENCIES[i]!).toBeCloseTo(
        noteToFrequency(TEST_CHORD_NOTES[i]!)!,
        10,
      );
    }
  });
});

describe("midiToPitchClass", () => {
  it("names pitch classes with sharp spelling", () => {
    expect(midiToPitchClass(60)).toBe("C");
    expect(midiToPitchClass(43)).toBe("G");
    expect(midiToPitchClass(46)).toBe("A#");
    expect(midiToPitchClass(40)).toBe("E");
  });
  it("wraps negatives, rounds, and rejects non-finite", () => {
    expect(midiToPitchClass(-1)).toBe("B");
    expect(midiToPitchClass(59.6)).toBe("C");
    expect(midiToPitchClass(Number.NaN)).toBeNull();
  });
});
