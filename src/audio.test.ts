import { describe, it, expect } from "vitest";
import {
  acousticPluckParams,
  DEFAULT_VOLUME,
  driveCompensation,
  MAX_MASTER_GAIN,
  reverbMix,
  volumeToGain,
  INSTRUMENT_LABELS,
  INSTRUMENTS,
  pluckParams,
  TONE_MAX_HZ,
  TONE_MIN_HZ,
  toneToCutoff,
  velocityToGain,
} from "./audio.ts";

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

describe("pluckParams", () => {
  it("acoustic is exactly acousticPluckParams", () => {
    expect(pluckParams("acoustic", 196, 1200)).toEqual(acousticPluckParams(196, 1200));
  });

  it("electric instruments sustain longer and are brighter than acoustic", () => {
    for (const inst of ["clean", "distortion"] as const) {
      for (const f of [82.41, 196, 329.63]) {
        const e = pluckParams(inst, f, 1500);
        const a = acousticPluckParams(f, 1500);
        expect(e.t60).toBeGreaterThan(a.t60);
        expect(e.brightness).toBeGreaterThan(a.brightness);
        expect(e.duration).toBeLessThanOrEqual(4.5);
        expect(e.duration).toBeLessThanOrEqual(e.t60);
      }
    }
  });

  it("palm mute is the same short thud on every instrument", () => {
    const a = pluckParams("acoustic", 110, 2000, true);
    expect(pluckParams("clean", 110, 2000, true)).toEqual(a);
    expect(pluckParams("distortion", 110, 2000, true)).toEqual(a);
  });

  it("is total for bad inputs", () => {
    const p = pluckParams("distortion", Number.NaN, -1);
    for (const x of [p.t60, p.brightness, p.duration]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThan(0);
    }
  });
});

describe("instrument list", () => {
  it("has a label for every instrument, acoustic first", () => {
    expect(INSTRUMENTS[0]).toBe("acoustic");
    for (const i of INSTRUMENTS) expect(INSTRUMENT_LABELS[i].length).toBeGreaterThan(0);
  });
});

describe("toneToCutoff", () => {
  it("maps the ends of the knob to the range ends", () => {
    expect(toneToCutoff(0)).toBeCloseTo(TONE_MIN_HZ, 6);
    expect(toneToCutoff(1)).toBeCloseTo(TONE_MAX_HZ, 6);
  });
  it("is exponential: the midpoint is the geometric mean", () => {
    expect(toneToCutoff(0.5)).toBeCloseTo(Math.sqrt(TONE_MIN_HZ * TONE_MAX_HZ), 6);
  });
  it("is monotonic, clamped, and NaN-safe", () => {
    expect(toneToCutoff(0.3)).toBeLessThan(toneToCutoff(0.6));
    expect(toneToCutoff(-4)).toBeCloseTo(TONE_MIN_HZ, 6);
    expect(toneToCutoff(9)).toBeCloseTo(TONE_MAX_HZ, 6);
    expect(toneToCutoff(Number.NaN)).toBeCloseTo(toneToCutoff(0.5), 6);
  });
});

describe("driveCompensation", () => {
  it("is unity when clean and falls as drive rises", () => {
    expect(driveCompensation(0)).toBe(1);
    expect(driveCompensation(0.6)).toBeLessThan(driveCompensation(0.3));
    expect(driveCompensation(1)).toBeCloseTo(1 / 13, 10);
  });
  it("clamps and is NaN-safe", () => {
    expect(driveCompensation(-1)).toBe(1);
    expect(driveCompensation(5)).toBeCloseTo(1 / 13, 10);
    expect(driveCompensation(Number.NaN)).toBe(1);
  });
});

describe("volumeToGain", () => {
  it("0 is silent, 1 is the max master gain", () => {
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(1)).toBeCloseTo(MAX_MASTER_GAIN, 10);
  });
  it("is squared (perceptual) and the default keeps the old 0.35 level", () => {
    expect(volumeToGain(0.5)).toBeCloseTo(MAX_MASTER_GAIN / 4, 10);
    expect(volumeToGain(DEFAULT_VOLUME)).toBeCloseTo(0.352, 3);
  });
  it("clamps and is NaN-safe", () => {
    expect(volumeToGain(-1)).toBe(0);
    expect(volumeToGain(3)).toBeCloseTo(MAX_MASTER_GAIN, 10);
    expect(volumeToGain(Number.NaN)).toBeCloseTo(volumeToGain(DEFAULT_VOLUME), 10);
  });
});

describe("reverbMix", () => {
  it("0 is fully dry", () => {
    expect(reverbMix(0)).toEqual({ dry: 1, wet: 0 });
  });
  it("wet rises and dry eases down as the amount goes up", () => {
    const a = reverbMix(0.3);
    const b = reverbMix(0.8);
    expect(b.wet).toBeGreaterThan(a.wet);
    expect(b.dry).toBeLessThan(a.dry);
    expect(reverbMix(1).dry).toBeGreaterThan(0.5);
  });
  it("clamps and is NaN-safe", () => {
    expect(reverbMix(-2)).toEqual(reverbMix(0));
    expect(reverbMix(5)).toEqual(reverbMix(1));
    const n = reverbMix(Number.NaN);
    expect(Number.isFinite(n.dry) && Number.isFinite(n.wet)).toBe(true);
  });
});
