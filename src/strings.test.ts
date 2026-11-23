import { describe, expect, it } from "vitest";
import {
  STRING_COUNT,
  STRING_NOTE_NAMES,
  computeStringYs,
  stringWidth,
} from "./strings.ts";
import { stringGlow } from "./strings.ts";

/**
 * Unit tests for the pure virtual-string geometry (task 2.1 / PRD §8). The
 * drawing itself is DOM-bound and verified by the e2e suite / a human, but the
 * line layout — count, spacing, bounds, ordering — is the part a camera-less
 * agent can verify, and is what strum detection (task 2.2) will build on.
 */
describe("computeStringYs", () => {
  it("produces six lines by default (a six-string guitar)", () => {
    expect(computeStringYs(0, 600)).toHaveLength(STRING_COUNT);
    expect(STRING_COUNT).toBe(6);
    expect(STRING_NOTE_NAMES).toHaveLength(STRING_COUNT);
  });

  it("returns lines top-to-bottom (strictly ascending y)", () => {
    const ys = computeStringYs(100, 700);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
  });

  it("keeps every line within the band and inside the margins", () => {
    const top = 100;
    const bottom = 700;
    const frac = 0.12;
    const margin = (bottom - top) * frac;
    const ys = computeStringYs(top, bottom, STRING_COUNT, frac);
    expect(ys[0]!).toBeCloseTo(top + margin, 6);
    expect(ys[ys.length - 1]!).toBeCloseTo(bottom - margin, 6);
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(top);
      expect(y).toBeLessThanOrEqual(bottom);
    }
  });

  it("spaces the lines evenly", () => {
    const ys = computeStringYs(0, 500);
    const gaps: number[] = [];
    for (let i = 1; i < ys.length; i++) gaps.push(ys[i]! - ys[i - 1]!);
    const first = gaps[0]!;
    for (const g of gaps) expect(g).toBeCloseTo(first, 6);
    // Lines are symmetric about the band centre.
    const centre = 250;
    expect(ys[0]! + ys[ys.length - 1]!).toBeCloseTo(2 * centre, 6);
  });

  it("centres a single line in the inner band", () => {
    const ys = computeStringYs(0, 100, 1);
    expect(ys).toHaveLength(1);
    expect(ys[0]!).toBeCloseTo(50, 6);
  });

  it("handles a degenerate zero-height band without NaN", () => {
    const ys = computeStringYs(300, 300);
    expect(ys).toHaveLength(STRING_COUNT);
    for (const y of ys) {
      expect(Number.isFinite(y)).toBe(true);
      expect(y).toBe(300);
    }
  });

  it("clamps an absurd margin fraction so the band never inverts", () => {
    const ys = computeStringYs(0, 100, STRING_COUNT, 5);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!);
    }
    for (const y of ys) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(100);
    }
  });

  it("floors a fractional count and guarantees at least one line", () => {
    expect(computeStringYs(0, 100, 3.9)).toHaveLength(3);
    expect(computeStringYs(0, 100, 0)).toHaveLength(1);
    expect(computeStringYs(0, 100, -2)).toHaveLength(1);
  });
});

describe("stringWidth", () => {
  it("is thickest at the top (low E) and thinnest at the bottom (high E)", () => {
    const widths: number[] = [];
    for (let i = 0; i < STRING_COUNT; i++) widths.push(stringWidth(i));
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]!).toBeLessThan(widths[i - 1]!);
    }
    expect(widths[0]!).toBeGreaterThan(widths[STRING_COUNT - 1]!);
  });

  it("hits the max and min at the endpoints", () => {
    expect(stringWidth(0, STRING_COUNT, 3.25, 1)).toBeCloseTo(3.25, 6);
    expect(stringWidth(STRING_COUNT - 1, STRING_COUNT, 3.25, 1)).toBeCloseTo(1, 6);
  });

  it("returns the max width for a single string", () => {
    expect(stringWidth(0, 1, 3.25, 1)).toBeCloseTo(3.25, 6);
  });
});

describe("stringGlow", () => {
  it("is 1 at the pluck and fades linearly to 0", () => {
    expect(stringGlow([10], 10)).toEqual([1]);
    expect(stringGlow([10], 10.125)[0]).toBeCloseTo(0.5, 10);
    expect(stringGlow([10], 10.3)).toEqual([0]);
  });
  it("never-plucked and future-scheduled strings", () => {
    expect(stringGlow([Number.NEGATIVE_INFINITY], 5)).toEqual([0]);
    expect(stringGlow([5.02], 5)).toEqual([1]);
  });
  it("degenerate fade gives no glow", () => {
    expect(stringGlow([1], 1, 0)).toEqual([0]);
  });
});
