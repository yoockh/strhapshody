import { describe, expect, it } from "vitest";
import { instrumentForKey, nextInstrument } from "./controls.ts";
import { INSTRUMENTS } from "./audio.ts";

describe("nextInstrument", () => {
  it("cycles acoustic → clean → distortion → acoustic", () => {
    expect(nextInstrument("acoustic")).toBe("clean");
    expect(nextInstrument("clean")).toBe("distortion");
    expect(nextInstrument("distortion")).toBe("acoustic");
  });
  it("visits every instrument once per cycle", () => {
    const seen = new Set<string>();
    let i = INSTRUMENTS[0]!;
    for (let n = 0; n < INSTRUMENTS.length; n++) {
      seen.add(i);
      i = nextInstrument(i);
    }
    expect(seen.size).toBe(INSTRUMENTS.length);
    expect(i).toBe(INSTRUMENTS[0]);
  });
});

describe("instrumentForKey", () => {
  it("number keys pick instruments directly", () => {
    expect(instrumentForKey("1", "distortion")).toBe("acoustic");
    expect(instrumentForKey("2", "acoustic")).toBe("clean");
    expect(instrumentForKey("3", "acoustic")).toBe("distortion");
  });
  it("I cycles, either case", () => {
    expect(instrumentForKey("i", "acoustic")).toBe("clean");
    expect(instrumentForKey("I", "distortion")).toBe("acoustic");
  });
  it("ignores keyboard-fallback keys and others", () => {
    for (const k of ["a", "C", "g", " ", "Shift", "4", "Enter"]) {
      expect(instrumentForKey(k, "acoustic")).toBeNull();
    }
  });
  it("ignores modifier chords so browser shortcuts still work", () => {
    expect(instrumentForKey("1", "acoustic", { ctrl: true })).toBeNull();
    expect(instrumentForKey("2", "acoustic", { meta: true })).toBeNull();
    expect(instrumentForKey("i", "acoustic", { alt: true })).toBeNull();
  });
});
