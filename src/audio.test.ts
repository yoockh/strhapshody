import { describe, it, expect } from "vitest";
import { acousticPluckParams, velocityToGain } from "./audio.ts";

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

describe("acousticPluckParams", () => {
  it("low strings ring longer than high strings", () => {
    const lowE = acousticPluckParams(82.41, 1500);
    const highE = acousticPluckParams(329.63, 1500);
    expect(lowE.t60).toBeGreaterThan(highE.t60);
    expect(lowE.t60).toBeGreaterThan(4);
    expect(highE.t60).toBeGreaterThan(2);
    expect(highE.t60).toBeLessThan(3);
  });

  it("clamps ring time to [1.2, 6] s", () => {
    expect(acousticPluckParams(20, 1000).t60).toBe(6);
    expect(acousticPluckParams(5000, 1000).t60).toBe(1.2);
  });

  it("never renders longer than the ring time or the 3.5 s cap", () => {
    for (const f of [41.2, 82.41, 110, 329.63, 1318.5]) {
      const p = acousticPluckParams(f, 1000);
      expect(p.duration).toBeLessThanOrEqual(p.t60);
      expect(p.duration).toBeLessThanOrEqual(3.5);
      expect(p.duration).toBeGreaterThan(0);
    }
  });

  it("harder strums are brighter, saturating at the reference speed", () => {
    const soft = acousticPluckParams(110, 200).brightness;
    const hard = acousticPluckParams(110, 3000).brightness;
    expect(hard).toBeGreaterThan(soft);
    expect(acousticPluckParams(110, 9000).brightness).toBeCloseTo(hard, 10);
    expect(hard).toBeLessThanOrEqual(1);
    expect(acousticPluckParams(110, 0).brightness).toBeGreaterThan(0);
  });

  it("palm-muted plucks are short and darker", () => {
    const open = acousticPluckParams(110, 2000);
    const muted = acousticPluckParams(110, 2000, true);
    expect(muted.t60).toBeLessThan(0.3);
    expect(muted.duration).toBeLessThan(0.5);
    expect(muted.brightness).toBeLessThan(open.brightness);
  });

  it("is total: bad inputs give finite, positive params", () => {
    for (const [f, v] of [
      [Number.NaN, Number.NaN],
      [-10, -10],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      const p = acousticPluckParams(f, v);
      for (const x of [p.t60, p.brightness, p.duration]) {
        expect(Number.isFinite(x)).toBe(true);
        expect(x).toBeGreaterThan(0);
      }
    }
  });
});
