import { describe, it, expect } from "vitest";
import {
  computeLeftZoneLayout,
  rectContains,
  nextPlayMode,
  type Rect,
} from "./powerstrip.ts";

describe("computeLeftZoneLayout", () => {
  it("puts the strip above the hex area within the zone", () => {
    const { strip, hexArea } = computeLeftZoneLayout(0, 60, 500, 900);
    // Strip sits at the top of the zone; hex area is strictly below it.
    expect(strip.top).toBeGreaterThanOrEqual(60);
    expect(strip.bottom).toBeGreaterThan(strip.top);
    expect(hexArea.top).toBeGreaterThanOrEqual(strip.bottom);
    expect(hexArea.bottom).toBeCloseTo(900, 9);
  });

  it("leaves a neutral gap between the strip and the hex area", () => {
    const { strip, hexArea } = computeLeftZoneLayout(0, 0, 500, 1000, 0.17, 0.06, 0.04);
    // gapFraction·height = 40px of neutral band between the two regions.
    expect(hexArea.top - strip.bottom).toBeCloseTo(40, 6);
  });

  it("insets the strip from the zone's left/right/top edges", () => {
    const { strip } = computeLeftZoneLayout(0, 0, 500, 1000, 0.17, 0.06);
    expect(strip.left).toBeCloseTo(30, 6); // 0.06·500
    expect(strip.right).toBeCloseTo(470, 6); // 500 − 30
    expect(strip.top).toBeCloseTo(60, 6); // 0.06·1000
    expect(strip.left).toBeGreaterThan(0);
    expect(strip.right).toBeLessThan(500);
  });

  it("hex area spans the full zone width", () => {
    const { hexArea } = computeLeftZoneLayout(10, 20, 510, 1020);
    expect(hexArea.left).toBe(10);
    expect(hexArea.right).toBe(510);
  });

  it("keeps all rectangles non-inverted on a degenerate zone", () => {
    for (const [l, t, r, b] of [
      [0, 0, 0, 0],
      [100, 100, 100, 100],
      [50, 50, 10, 10], // right/bottom below left/top
    ] as const) {
      const { strip, hexArea } = computeLeftZoneLayout(l, t, r, b);
      for (const rect of [strip, hexArea]) {
        expect(rect.right).toBeGreaterThanOrEqual(rect.left);
        expect(rect.bottom).toBeGreaterThanOrEqual(rect.top);
        expect(Number.isFinite(rect.left)).toBe(true);
        expect(Number.isFinite(rect.bottom)).toBe(true);
      }
    }
  });

  it("clamps non-finite inputs rather than producing NaN rectangles", () => {
    const { strip, hexArea } = computeLeftZoneLayout(
      Number.NaN,
      0,
      Number.POSITIVE_INFINITY,
      500,
    );
    for (const rect of [strip, hexArea]) {
      for (const v of [rect.left, rect.top, rect.right, rect.bottom]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("never pushes the hex-area top past the zone bottom", () => {
    // A very short zone: strip + gap would overrun the bottom; it's floored.
    const { hexArea } = computeLeftZoneLayout(0, 0, 500, 40);
    expect(hexArea.top).toBeLessThanOrEqual(hexArea.bottom);
  });
});

describe("rectContains", () => {
  const rect: Rect = { left: 10, top: 20, right: 110, bottom: 60 };

  it("includes interior and edge points", () => {
    expect(rectContains(rect, { x: 50, y: 40 })).toBe(true);
    expect(rectContains(rect, { x: 10, y: 20 })).toBe(true); // corner
    expect(rectContains(rect, { x: 110, y: 60 })).toBe(true); // opposite corner
  });

  it("excludes points outside any edge", () => {
    expect(rectContains(rect, { x: 9, y: 40 })).toBe(false);
    expect(rectContains(rect, { x: 50, y: 61 })).toBe(false);
  });

  it("treats null / non-finite points as outside", () => {
    expect(rectContains(rect, null)).toBe(false);
    expect(rectContains(rect, { x: Number.NaN, y: 40 })).toBe(false);
    expect(rectContains(rect, { x: 50, y: Number.POSITIVE_INFINITY })).toBe(false);
  });
});

describe("nextPlayMode", () => {
  it("enters Power when the cursor is on the strip", () => {
    expect(nextPlayMode("Chord", true, false)).toBe("Power");
  });

  it("returns to Chord when the cursor is in the hex area", () => {
    expect(nextPlayMode("Power", false, true)).toBe("Chord");
  });

  it("holds the current mode in the neutral gap (neither region)", () => {
    expect(nextPlayMode("Chord", false, false)).toBe("Chord");
    expect(nextPlayMode("Power", false, false)).toBe("Power");
  });

  it("holds the current mode when no hand is tracked (both false)", () => {
    // A brief dropout (cursor null → both false) must not flip the mode.
    expect(nextPlayMode("Power", false, false)).toBe("Power");
  });

  it("gives the strip priority if a degenerate layout overlaps both", () => {
    expect(nextPlayMode("Chord", true, true)).toBe("Power");
  });

  it("does not flicker across the boundary gap (round trip)", () => {
    // Chord → into strip → Power → leave into gap → stays Power → into hex → Chord.
    let m = nextPlayMode("Chord", true, false);
    expect(m).toBe("Power");
    m = nextPlayMode(m, false, false); // in the gap
    expect(m).toBe("Power");
    m = nextPlayMode(m, false, true); // reached the hex area
    expect(m).toBe("Chord");
    m = nextPlayMode(m, false, false); // back in the gap
    expect(m).toBe("Chord");
  });
});
