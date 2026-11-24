import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  hexScale,
  MIN_HEX_SCALE,
  smoothingMinCutoff,
  SMOOTHING_HEAVY_HZ,
  SMOOTHING_LIGHT_HZ,
  strumMinVelocity,
  validateSettings,
} from "./settings.ts";

describe("validateSettings", () => {
  it("returns defaults for garbage", () => {
    for (const raw of [null, undefined, 3, "x", []]) {
      expect(validateSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });
  it("round-trips a full valid object", () => {
    const s = {
      leftHanded: true,
      strumThreshold: 0.7,
      smoothing: 0.1,
      hexSize: 0.2,
      powerOctave: false,
      instrument: "distortion",
      volume: 0.5,
      reverb: 0.9,
    };
    expect(validateSettings(JSON.parse(JSON.stringify(s)))).toEqual(s);
  });
  it("keeps valid fields and defaults the invalid ones independently", () => {
    const s = validateSettings({ leftHanded: true, volume: "loud", instrument: "banjo", hexSize: 0.4 });
    expect(s.leftHanded).toBe(true);
    expect(s.hexSize).toBe(0.4);
    expect(s.volume).toBe(DEFAULT_SETTINGS.volume);
    expect(s.instrument).toBe(DEFAULT_SETTINGS.instrument);
  });
  it("clamps knobs to [0,1] and rejects non-finite numbers", () => {
    const s = validateSettings({ strumThreshold: 4, smoothing: -1, reverb: Number.NaN });
    expect(s.strumThreshold).toBe(1);
    expect(s.smoothing).toBe(0);
    expect(s.reverb).toBe(DEFAULT_SETTINGS.reverb);
  });
  it("defaults are themselves valid", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("strumMinVelocity", () => {
  it("0 disables the threshold", () => {
    expect(strumMinVelocity(0, 720)).toBe(0);
  });
  it("default sits between a drift and a real strum on a 720 px canvas", () => {
    const v = strumMinVelocity(DEFAULT_SETTINGS.strumThreshold, 720);
    expect(v).toBeGreaterThan(80);
    expect(v).toBeLessThan(500);
  });
  it("scales with canvas height and rises with the knob", () => {
    expect(strumMinVelocity(0.5, 1440)).toBeCloseTo(2 * strumMinVelocity(0.5, 720), 10);
    expect(strumMinVelocity(0.8, 720)).toBeGreaterThan(strumMinVelocity(0.4, 720));
  });
  it("is NaN-safe", () => {
    expect(strumMinVelocity(Number.NaN, 720)).toBeCloseTo(
      strumMinVelocity(DEFAULT_SETTINGS.strumThreshold, 720),
      10,
    );
    expect(strumMinVelocity(0.5, Number.NaN)).toBe(0);
  });
});

describe("smoothingMinCutoff", () => {
  it("spans light → heavy and is monotone decreasing", () => {
    expect(smoothingMinCutoff(0)).toBeCloseTo(SMOOTHING_LIGHT_HZ, 10);
    expect(smoothingMinCutoff(1)).toBeCloseTo(SMOOTHING_HEAVY_HZ, 10);
    expect(smoothingMinCutoff(0.7)).toBeLessThan(smoothingMinCutoff(0.3));
  });
  it("default stays near the pre-settings 1.5 Hz cursor", () => {
    const hz = smoothingMinCutoff(DEFAULT_SETTINGS.smoothing);
    expect(hz).toBeGreaterThan(1.2);
    expect(hz).toBeLessThan(1.8);
  });
});

describe("hexScale", () => {
  it("maps the knob to [MIN_HEX_SCALE, 1]", () => {
    expect(hexScale(0)).toBeCloseTo(MIN_HEX_SCALE, 10);
    expect(hexScale(1)).toBe(1);
    expect(hexScale(0.5)).toBeCloseTo((MIN_HEX_SCALE + 1) / 2, 10);
    expect(hexScale(Number.NaN)).toBe(hexScale(DEFAULT_SETTINGS.hexSize));
  });
});
