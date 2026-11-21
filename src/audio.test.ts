import { describe, it, expect } from "vitest";
import { velocityToGain } from "./audio.ts";

// Only the pure velocity→gain mapping is unit-tested here; the Web Audio
// wrapper (createAudioEngine) needs a live AudioContext and is exercised by the
// Playwright e2e suite (task 7.1), per ADR-0002 / TESTING.md.

const MIN = 0.08;
const MAX = 1;

describe("velocityToGain", () => {
  it("returns the floor gain for a zero / non-positive velocity", () => {
    expect(velocityToGain(0)).toBeCloseTo(MIN, 10);
    expect(velocityToGain(-500)).toBeCloseTo(MIN, 10);
  });

  it("returns the floor gain (never NaN) for non-finite velocity", () => {
    expect(velocityToGain(Number.NaN)).toBeCloseTo(MIN, 10);
    expect(velocityToGain(Number.POSITIVE_INFINITY)).toBeCloseTo(MIN, 10);
    expect(velocityToGain(Number.NEGATIVE_INFINITY)).toBeCloseTo(MIN, 10);
  });

  it("saturates at maxGain at and beyond the reference velocity", () => {
    expect(velocityToGain(3000)).toBeCloseTo(MAX, 10);
    expect(velocityToGain(9000)).toBeCloseTo(MAX, 10);
  });

  it("is linear in velocity up to the reference (half speed → half range)", () => {
    expect(velocityToGain(1500)).toBeCloseTo(MIN + (MAX - MIN) * 0.5, 10);
  });

  it("increases monotonically with velocity", () => {
    let prev = velocityToGain(1);
    for (const v of [100, 500, 1000, 2000, 2999, 3000, 5000]) {
      const g = velocityToGain(v);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
  });

  it("always stays within [minGain, maxGain]", () => {
    for (const v of [-10, 0, 1, 50, 1234, 3000, 1e6, Number.NaN]) {
      const g = velocityToGain(v);
      expect(g).toBeGreaterThanOrEqual(MIN);
      expect(g).toBeLessThanOrEqual(MAX);
    }
  });

  it("honours custom options", () => {
    const g = velocityToGain(500, {
      refVelocity: 1000,
      minGain: 0.2,
      maxGain: 0.8,
    });
    expect(g).toBeCloseTo(0.2 + (0.8 - 0.2) * 0.5, 10);
  });
});
