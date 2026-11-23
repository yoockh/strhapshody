import { describe, expect, it } from "vitest";
import {
  keyAction,
  KEYBOARD_STRUM_VELOCITY,
  RAKE_SECONDS,
  rakeSchedule,
  UPSTROKE_FACTOR,
} from "./keyboard.ts";
import { QUALITY_MAJOR, QUALITY_MINOR } from "./chords.ts";

describe("keyAction", () => {
  it("letters A–G select a major chord, either case", () => {
    expect(keyAction({ key: "c" })).toEqual({ kind: "chord", root: "C", quality: QUALITY_MAJOR });
    expect(keyAction({ key: "G" })).toEqual({ kind: "chord", root: "G", quality: QUALITY_MAJOR });
  });
  it("Shift+letter selects minor", () => {
    expect(keyAction({ key: "A", shiftKey: true })).toEqual({
      kind: "chord",
      root: "A",
      quality: QUALITY_MINOR,
    });
  });
  it("Space strums down, Shift+Space strums up", () => {
    expect(keyAction({ key: " ", code: "Space" })).toEqual({ kind: "strum", direction: "down" });
    expect(keyAction({ key: " ", shiftKey: true })).toEqual({ kind: "strum", direction: "up" });
    expect(keyAction({ key: "Unidentified", code: "Space" })).toEqual({
      kind: "strum",
      direction: "down",
    });
  });
  it("ignores other keys, including the instrument shortcuts", () => {
    for (const key of ["h", "I", "1", "2", "3", "Enter", "Shift", "Escape", "ArrowUp", "a1"]) {
      expect(keyAction({ key })).toBeNull();
    }
  });
  it("ignores modifier chords and auto-repeat", () => {
    expect(keyAction({ key: "c", ctrlKey: true })).toBeNull();
    expect(keyAction({ key: "c", metaKey: true })).toBeNull();
    expect(keyAction({ key: " ", altKey: true })).toBeNull();
    expect(keyAction({ key: " ", repeat: true })).toBeNull();
  });
});

describe("rakeSchedule", () => {
  it("downstroke rakes low E → high e", () => {
    const r = rakeSchedule("down");
    expect(r.map((s) => s.string)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it("upstroke rakes high e → low E, lighter", () => {
    const r = rakeSchedule("up");
    expect(r.map((s) => s.string)).toEqual([5, 4, 3, 2, 1, 0]);
    expect(r[0]!.velocity).toBeCloseTo(KEYBOARD_STRUM_VELOCITY * UPSTROKE_FACTOR, 10);
    expect(r[0]!.velocity).toBeLessThan(rakeSchedule("down")[0]!.velocity);
  });
  it("strings are evenly spaced in time starting at 0", () => {
    const r = rakeSchedule("down");
    r.forEach((s, i) => expect(s.delay).toBeCloseTo(i * RAKE_SECONDS, 12));
    expect(r[5]!.delay).toBeLessThan(0.1); // whole strum well under 100 ms
  });
});
