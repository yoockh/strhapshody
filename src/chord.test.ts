import { describe, it, expect } from "vitest";
import { chordLabel, qualitySuffix, NO_CHORD_LABEL } from "./chord.ts";

// Mirror the engine's ChordQuality enum integer values (engine/src/fingercount.rs)
// so the test documents the contract chord.ts depends on.
const UNKNOWN = 0;
const MAJOR = 1;
const MINOR = 2;
const DOMINANT7 = 3;

describe("qualitySuffix", () => {
  it("adds no suffix for major", () => {
    expect(qualitySuffix(MAJOR)).toBe("");
  });

  it("adds 'm' for minor", () => {
    expect(qualitySuffix(MINOR)).toBe("m");
  });

  it("adds '7' for dominant 7th", () => {
    expect(qualitySuffix(DOMINANT7)).toBe("7");
  });

  it("renders unknown as no suffix (should not reach the display layer)", () => {
    expect(qualitySuffix(UNKNOWN)).toBe("");
  });

  it("falls back to no suffix for an out-of-range value", () => {
    expect(qualitySuffix(99)).toBe("");
    expect(qualitySuffix(-1)).toBe("");
  });
});

describe("chordLabel", () => {
  it("formats a major chord as just the root letter", () => {
    expect(chordLabel("C", MAJOR)).toBe("C");
    expect(chordLabel("G", MAJOR)).toBe("G");
  });

  it("formats a minor chord with an 'm' suffix", () => {
    expect(chordLabel("A", MINOR)).toBe("Am");
  });

  it("formats a dominant 7th with a '7' suffix", () => {
    expect(chordLabel("D", DOMINANT7)).toBe("D7");
  });

  it("shows the placeholder when no root is selected", () => {
    expect(chordLabel(null, MAJOR)).toBe(NO_CHORD_LABEL);
    expect(chordLabel(undefined, MINOR)).toBe(NO_CHORD_LABEL);
    expect(chordLabel("", DOMINANT7)).toBe(NO_CHORD_LABEL);
  });

  it("uses an em dash as the placeholder", () => {
    expect(NO_CHORD_LABEL).toBe("—");
  });
});
