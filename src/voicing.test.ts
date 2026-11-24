import { describe, expect, it } from "vitest";
import {
  chordVoicing,
  powerChordLabel,
  powerVoicing,
  selectVoicing,
  stringLabel,
  type PowerSelection,
} from "./voicing.ts";
import { chordFrequencies, QUALITY_MAJOR, QUALITY_MINOR } from "./chords.ts";
import { noteToFrequency } from "./notes.ts";

// Engine string indices (ADR-0013): Upper pair = root 0 / fifth 1 / octave 2,
// Lower pair = root 1 / fifth 2 / octave 3.
const upper = (fret: number): PowerSelection => ({
  fret,
  rootString: 0,
  fifthString: 1,
  octaveString: 2,
});
const lower = (fret: number): PowerSelection => ({
  fret,
  rootString: 1,
  fifthString: 2,
  octaveString: 3,
});

const hz = (n: string): number => noteToFrequency(n)!;

describe("stringLabel", () => {
  it("names the outer strings low E / high e and the rest by letter", () => {
    expect(stringLabel(0)).toBe("low E");
    expect(stringLabel(1)).toBe("A");
    expect(stringLabel(4)).toBe("B");
    expect(stringLabel(5)).toBe("high e");
    expect(stringLabel(9)).toBe("?");
  });
});

describe("powerChordLabel", () => {
  it("matches the PRD example G5 (fret 3, low E)", () => {
    expect(powerChordLabel(3, 0)).toBe("G5 (fret 3, low E)");
  });
  it("names open and sharp roots on both pairs", () => {
    expect(powerChordLabel(0, 0)).toBe("E5 (fret 0, low E)");
    expect(powerChordLabel(0, 1)).toBe("A5 (fret 0, A)");
    expect(powerChordLabel(1, 1)).toBe("A#5 (fret 1, A)");
    expect(powerChordLabel(12, 0)).toBe("E5 (fret 12, low E)");
  });
  it("rejects invalid frets and strings", () => {
    expect(powerChordLabel(-1, 0)).toBeNull();
    expect(powerChordLabel(1.5, 0)).toBeNull();
    expect(powerChordLabel(3, -1)).toBeNull();
    expect(powerChordLabel(3, 6)).toBeNull();
  });
});

describe("powerVoicing", () => {
  it("G5 on low E: G2 + D3 (+ G3 octave), everything else silent", () => {
    const v = powerVoicing(upper(3), true)!;
    expect(v.label).toBe("G5 (fret 3, low E)");
    expect(v.frequencies[0]).toBeCloseTo(hz("G2"), 6);
    expect(v.frequencies[1]).toBeCloseTo(hz("D3"), 6);
    expect(v.frequencies[2]).toBeCloseTo(hz("G3"), 6);
    expect(v.frequencies.slice(3)).toEqual([0, 0, 0]);
  });

  it("restricts to exactly 2 strings without the octave", () => {
    const v = powerVoicing(upper(3), false)!;
    const sounding = v.frequencies.filter((f) => f > 0);
    expect(sounding).toHaveLength(2);
    expect(v.frequencies[2]).toBe(0);
  });

  it("lower pair roots on the A string: C5 at fret 3 = C3 + G3 + C4", () => {
    const v = powerVoicing(lower(3), true)!;
    expect(v.label).toBe("C5 (fret 3, A)");
    expect(v.frequencies[0]).toBe(0);
    expect(v.frequencies[1]).toBeCloseTo(hz("C3"), 6);
    expect(v.frequencies[2]).toBeCloseTo(hz("G3"), 6);
    expect(v.frequencies[3]).toBeCloseTo(hz("C4"), 6);
    expect(v.frequencies.slice(4)).toEqual([0, 0]);
  });

  it("fifth is a perfect fifth and octave is double the root at every fret", () => {
    for (const make of [upper, lower]) {
      for (let fret = 0; fret <= 12; fret++) {
        const sel = make(fret);
        const v = powerVoicing(sel, true)!;
        const root = v.frequencies[sel.rootString]!;
        const fifth = v.frequencies[sel.fifthString]!;
        const octave = v.frequencies[sel.octaveString]!;
        expect(fifth / root).toBeCloseTo(Math.pow(2, 7 / 12), 9);
        expect(octave / root).toBeCloseTo(2, 9);
      }
    }
  });

  it("moving right on the strip raises the pitch", () => {
    for (let fret = 1; fret <= 12; fret++) {
      const a = powerVoicing(upper(fret - 1), false)!.frequencies[0]!;
      const b = powerVoicing(upper(fret), false)!.frequencies[0]!;
      expect(b).toBeGreaterThan(a);
    }
  });

  it("keys differ by fret, pair and octave flag, and are stable", () => {
    const keys = new Set([
      powerVoicing(upper(3), true)!.key,
      powerVoicing(upper(3), false)!.key,
      powerVoicing(upper(4), true)!.key,
      powerVoicing(lower(3), true)!.key,
    ]);
    expect(keys.size).toBe(4);
    expect(powerVoicing(upper(3), true)!.key).toBe(powerVoicing(upper(3), true)!.key);
  });

  it("returns null for an invalid selection", () => {
    expect(powerVoicing(upper(-1), true)).toBeNull();
    expect(powerVoicing({ ...upper(3), rootString: 7 }, true)).toBeNull();
  });

  it("leaves an invalid fifth/octave string silent instead of failing", () => {
    const v = powerVoicing({ fret: 3, rootString: 0, fifthString: -1, octaveString: 9 }, true)!;
    expect(v.frequencies.filter((f) => f > 0)).toHaveLength(1);
  });
});

describe("chordVoicing", () => {
  it("uses the chord table and the chord label", () => {
    const v = chordVoicing({ root: "a", quality: QUALITY_MINOR })!;
    expect(v.label).toBe("Am");
    expect(v.frequencies).toEqual(chordFrequencies("A", QUALITY_MINOR));
    expect(v.key).toBe(`chord:A:${QUALITY_MINOR}`);
  });
  it("returns null when nothing is committed or the root is unknown", () => {
    expect(chordVoicing({ root: null, quality: QUALITY_MAJOR })).toBeNull();
    expect(chordVoicing({ root: "H", quality: QUALITY_MAJOR })).toBeNull();
  });
});

describe("selectVoicing", () => {
  const chord = { root: "C", quality: QUALITY_MAJOR };

  it("Power mode with a selection sounds the power chord", () => {
    const v = selectVoicing("Power", upper(3), chord, true)!;
    expect(v.key.startsWith("power:")).toBe(true);
  });
  it("Chord mode ignores a held power selection", () => {
    const v = selectVoicing("Chord", upper(3), chord, true)!;
    expect(v.label).toBe("C");
  });
  it("Power mode with no fret yet falls back to the latched chord", () => {
    expect(selectVoicing("Power", null, chord, true)!.label).toBe("C");
  });
  it("returns null when neither selection is valid", () => {
    expect(selectVoicing("Power", null, { root: null, quality: QUALITY_MAJOR }, true)).toBeNull();
  });
});
