import { describe, expect, it } from "vitest";
import {
  calibratedZones,
  CalibrationSession,
  MIN_SAMPLES,
  PHASE_SECONDS,
  calibrationPrompt,
  MIN_CHORD_SPAN,
  MIN_STRUM_SPAN,
  mirrorBox,
  usableChordRange,
  usableStrumRange,
  robustRange,
  validateCalibration,
  type Calibration,
} from "./calibration.ts";

const W = 1280;
const H = 720;
const BAR = 50;

/** Points on a grid covering a box. */
function grid(l: number, t: number, r: number, b: number, n = 10) {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push({ x: l + ((r - l) * i) / (n - 1), y: t + ((b - t) * j) / (n - 1) });
    }
  }
  return pts;
}

describe("robustRange", () => {
  it("needs enough samples", () => {
    expect(robustRange(grid(0.1, 0.1, 0.2, 0.2, 5).slice(0, MIN_SAMPLES - 1))).toBeNull();
    expect(robustRange([])).toBeNull();
  });
  it("covers the bulk of the points", () => {
    const box = robustRange(grid(0.1, 0.3, 0.4, 0.8))!;
    expect(box.left).toBeCloseTo(0.1, 1);
    expect(box.right).toBeCloseTo(0.4, 1);
    expect(box.top).toBeCloseTo(0.3, 1);
    expect(box.bottom).toBeCloseTo(0.8, 1);
  });
  it("ignores a few stray outliers", () => {
    const pts = [...grid(0.1, 0.3, 0.4, 0.8), { x: 0.99, y: 0.01 }, { x: 0.98, y: 0.02 }];
    const box = robustRange(pts)!;
    expect(box.right).toBeLessThan(0.45);
    expect(box.top).toBeGreaterThan(0.25);
  });
  it("drops non-finite points and clamps to [0,1]", () => {
    const pts = [...grid(-0.2, 0.5, 0.3, 1.3), { x: Number.NaN, y: 0.5 }];
    const box = robustRange(pts)!;
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(1);
  });
});

describe("CalibrationSession", () => {
  const L = { x: 0.2, y: 0.5 };
  const R = { x: 0.8, y: 0.5 };

  it("walks intro → left → right → done → finished on schedule", () => {
    const s = new CalibrationSession(100);
    expect(s.update(100, L, R).phase).toBe("intro");
    expect(s.update(100 + PHASE_SECONDS.intro + 0.1, L, R).phase).toBe("chord");
    const tRight = 100 + PHASE_SECONDS.intro + PHASE_SECONDS.chord + 0.1;
    expect(s.update(tRight, L, R).phase).toBe("strum");
    const tDone = tRight + PHASE_SECONDS.strum;
    expect(s.update(tDone, L, R).phase).toBe("done");
    const end = s.update(tDone + PHASE_SECONDS.done, L, R);
    expect(end.finished).toBe(true);
    expect(end.progress).toBe(1);
  });

  it("totals about 20 seconds", () => {
    const total = Object.values(PHASE_SECONDS).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(18);
    expect(total).toBeLessThanOrEqual(22);
  });

  it("records each hand only during its own phase", () => {
    const s = new CalibrationSession(0);
    const fps = 30;
    for (let f = 0; f < 21 * fps; f++) s.update(f / fps, L, R);
    const { chord, strum } = s.sampleCounts;
    expect(chord).toBeGreaterThan(PHASE_SECONDS.chord * fps - 3);
    expect(chord).toBeLessThan(PHASE_SECONDS.chord * fps + 3);
    expect(strum).toBeGreaterThan(PHASE_SECONDS.strum * fps - 3);
    expect(strum).toBeLessThan(PHASE_SECONDS.strum * fps + 3);
  });

  it("produces each hand's range; a missing hand stays null", () => {
    const s = new CalibrationSession(0);
    const leftPts = grid(0.1, 0.3, 0.35, 0.85, 16);
    let i = 0;
    for (let f = 0; f < 21 * 30; f++) {
      s.update(f / 30, leftPts[i++ % leftPts.length]!, null);
    }
    const c = s.result();
    expect(c.chord).not.toBeNull();
    expect(c.chord!.left).toBeCloseTo(0.1, 1);
    expect(c.strum).toBeNull();
    expect(c.leftHanded).toBe(false);
    expect(s.result(true).leftHanded).toBe(true);
  });

  it("reports progress and a countdown, and a live box once sampling", () => {
    const s = new CalibrationSession(0);
    const v0 = s.update(0, null, null);
    expect(v0.secondsLeft).toBe(PHASE_SECONDS.intro);
    expect(v0.liveBox).toBeNull();
    const pts = grid(0.1, 0.3, 0.3, 0.6, 4);
    let v = v0;
    for (let k = 0; k < 16; k++) v = s.update(PHASE_SECONDS.intro + k / 30, pts[k]!, null);
    expect(v.phase).toBe("chord");
    expect(v.progress).toBeGreaterThan(0);
    expect(v.progress).toBeLessThan(0.1);
    expect(v.liveBox).not.toBeNull();
  });

  it("tolerates a non-finite clock", () => {
    const s = new CalibrationSession(Number.NaN);
    expect(s.update(Number.NaN, null, null).phase).toBe("intro");
  });
});

describe("validateCalibration", () => {
  const good: Calibration = {
    version: 1,
    chord: { left: 0.1, top: 0.3, right: 0.4, bottom: 0.9 },
    strum: null,
    leftHanded: false,
  };
  it("accepts a good calibration (one hand may be null)", () => {
    expect(validateCalibration(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  it("rejects garbage, wrong versions, inverted or out-of-range boxes, and all-null", () => {
    expect(validateCalibration(null)).toBeNull();
    expect(validateCalibration("x")).toBeNull();
    expect(validateCalibration({ ...good, version: 2 })).toBeNull();
    expect(validateCalibration({ ...good, chord: { left: 0.5, top: 0.3, right: 0.4, bottom: 0.9 } })).toBeNull();
    expect(validateCalibration({ ...good, chord: { left: 0.1, top: 0.3, right: 1.4, bottom: 0.9 } })).toBeNull();
    expect(validateCalibration({ ...good, chord: { left: "0.1" } })).toBeNull();
    expect(validateCalibration({ version: 1, chord: null, strum: null })).toBeNull();
    expect(validateCalibration({ ...good, leftHanded: "yes" })).toBeNull();
  });
  it("treats a missing leftHanded flag as right-handed", () => {
    const { leftHanded: _omit, ...rest } = good;
    expect(validateCalibration(rest)!.leftHanded).toBe(false);
  });
});

describe("calibratedZones", () => {
  it("without calibration each zone is its half below the status bar", () => {
    const z = calibratedZones(null, W, H, BAR);
    expect(z.chord).toEqual({ left: 0, top: BAR, right: W / 2, bottom: H });
    expect(z.strum).toEqual({ left: W / 2, top: BAR, right: W, bottom: H });
  });

  it("fits zones to the recorded ranges, with padding", () => {
    const z = calibratedZones(
      {
        version: 1,
        chord: { left: 0.05, top: 0.3, right: 0.4, bottom: 0.95 },
        strum: { left: 0.6, top: 0.25, right: 0.95, bottom: 0.85 },
      },
      W,
      H,
      BAR,
    );
    // contains the raw range
    expect(z.chord.left).toBeLessThanOrEqual(0.05 * W);
    expect(z.chord.right).toBeGreaterThanOrEqual(0.4 * W);
    expect(z.strum.top).toBeLessThanOrEqual(0.25 * H);
    expect(z.strum.bottom).toBeGreaterThanOrEqual(0.85 * H);
    // but is smaller than the full half
    expect(z.strum.bottom - z.strum.top).toBeLessThan(H - BAR);
  });

  it("keeps each zone inside its half and below the bar", () => {
    const z = calibratedZones(
      {
        version: 1,
        chord: { left: 0.3, top: 0.0, right: 0.7, bottom: 0.3 }, // strays right & under the bar
        strum: { left: 0.4, top: 0.7, right: 1.0, bottom: 1.0 },
      },
      W,
      H,
      BAR,
    );
    expect(z.chord.left).toBeGreaterThanOrEqual(0);
    expect(z.chord.right).toBeLessThanOrEqual(W / 2);
    expect(z.chord.top).toBeGreaterThanOrEqual(BAR);
    expect(z.strum.left).toBeGreaterThanOrEqual(W / 2);
    expect(z.strum.right).toBeLessThanOrEqual(W);
    expect(z.strum.bottom).toBeLessThanOrEqual(H);
  });

  it("grows a tiny range to a playable minimum", () => {
    const z = calibratedZones(
      {
        version: 1,
        chord: { left: 0.2, top: 0.5, right: 0.21, bottom: 0.51 },
        strum: { left: 0.7, top: 0.5, right: 0.71, bottom: 0.51 },
      },
      W,
      H,
      BAR,
    );
    expect(z.chord.right - z.chord.left).toBeGreaterThanOrEqual((W / 2) * 0.55 - 1e-6);
    expect(z.chord.bottom - z.chord.top).toBeGreaterThanOrEqual((H - BAR) * 0.6 - 1e-6);
    expect(z.strum.bottom - z.strum.top).toBeGreaterThanOrEqual((H - BAR) * 0.45 - 1e-6);
  });

  it("uses the default half for a hand with no range", () => {
    const z = calibratedZones(
      { version: 1, chord: null, strum: { left: 0.6, top: 0.3, right: 0.9, bottom: 0.7 } },
      W,
      H,
      BAR,
    );
    expect(z.chord).toEqual({ left: 0, top: BAR, right: W / 2, bottom: H });
  });

  it("survives degenerate canvas sizes", () => {
    const z = calibratedZones(null, 0, Number.NaN, Number.NaN);
    for (const r of [z.chord, z.strum]) {
      for (const v of [r.left, r.top, r.right, r.bottom]) expect(Number.isFinite(v)).toBe(true);
      expect(r.right).toBeGreaterThanOrEqual(r.left);
      expect(r.bottom).toBeGreaterThanOrEqual(r.top);
    }
  });
});

describe("left-handed zones (task 6.2)", () => {
  const calib: Calibration = {
    version: 1,
    chord: { left: 0.05, top: 0.3, right: 0.4, bottom: 0.95 },
    strum: { left: 0.6, top: 0.25, right: 0.95, bottom: 0.85 },
    leftHanded: false,
  };

  it("uncalibrated: chord zone on the right half, strings on the left", () => {
    const z = calibratedZones(null, W, H, BAR, true);
    expect(z.chord).toEqual({ left: W / 2, top: BAR, right: W, bottom: H });
    expect(z.strum).toEqual({ left: 0, top: BAR, right: W / 2, bottom: H });
  });

  it("a right-handed calibration is mirrored when switching to left-handed", () => {
    const z = calibratedZones(calib, W, H, BAR, true);
    const rh = calibratedZones(calib, W, H, BAR, false);
    expect(z.chord.left).toBeCloseTo(W - rh.chord.right, 6);
    expect(z.chord.right).toBeCloseTo(W - rh.chord.left, 6);
    expect(z.chord.top).toBeCloseTo(rh.chord.top, 6);
    expect(z.strum.left).toBeCloseTo(W - rh.strum.right, 6);
  });

  it("a left-handed calibration is used as recorded when left-handed", () => {
    const lh: Calibration = {
      version: 1,
      chord: mirrorBox(calib.chord!),
      strum: mirrorBox(calib.strum!),
      leftHanded: true,
    };
    expect(calibratedZones(lh, W, H, BAR, true)).toEqual(calibratedZones(calib, W, H, BAR, true));
  });

  it("mirrorBox flips x only and is an involution", () => {
    const b = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 };
    const m = mirrorBox(b);
    expect(m.left).toBeCloseTo(0.7, 10);
    expect(m.right).toBeCloseTo(0.9, 10);
    expect(m.top).toBe(0.2);
    const back = mirrorBox(m);
    expect(back.left).toBeCloseTo(b.left, 10);
    expect(back.right).toBeCloseTo(b.right, 10);
  });

  it("prompts name the right hands", () => {
    expect(calibrationPrompt("chord")[1]).toContain("left hand");
    expect(calibrationPrompt("chord", true)[1]).toContain("right hand");
    expect(calibrationPrompt("strum", true)[0]).toBe("Left hand");
    expect(calibrationPrompt("intro", true)[1]).toContain("right for chords");
  });
});

// Regression (2026-11-24, first real-webcam run): hands resting near the bottom
// of the frame during calibration produced tiny ranges, and the zones shrank
// to their minimum size in the bottom corner (strings squeezed at the bottom).
describe("calibration rejects ranges with too little movement", () => {
  /** A hand jittering ±1% around a point. */
  const resting = (x: number, y: number, n = 240) =>
    Array.from({ length: n }, (_, i) => ({
      x: x + 0.01 * Math.sin(i),
      y: y + 0.01 * Math.cos(i * 1.3),
    }));

  it("a resting hand gives no usable range for either role", () => {
    const s = new CalibrationSession(0);
    const chord = resting(0.35, 0.92);
    const strum = resting(0.6, 0.93);
    let i = 0;
    for (let f = 0; f < 21 * 30; f++, i++) {
      s.update(f / 30, chord[i % chord.length]!, strum[i % strum.length]!);
    }
    const c = s.result();
    expect(c.chord).toBeNull();
    expect(c.strum).toBeNull();
    expect(s.outcome()).toEqual({ chord: false, strum: false });
    // …so the zones stay at their defaults instead of collapsing to a corner.
    expect(calibratedZones(c, W, H, BAR)).toEqual(calibratedZones(null, W, H, BAR));
  });

  it("the done view reports the outcome and the prompt explains it", () => {
    const s = new CalibrationSession(0);
    const big = grid(0.1, 0.3, 0.4, 0.8, 16);
    let i = 0;
    let view = s.update(0, null, null);
    for (let f = 0; f < 20 * 30; f++, i++) {
      view = s.update(f / 30, big[i % big.length]!, { x: 0.7, y: 0.9 });
    }
    expect(view.phase).toBe("done");
    expect(view.outcome).toEqual({ chord: true, strum: false });
    const [, body] = calibrationPrompt("done", false, view.outcome);
    expect(body).toContain("right hand");
    expect(body).toContain("kept the default zone");
    expect(calibrationPrompt("done", false, { chord: true, strum: true })[1]).toContain("resized");
  });

  it("thresholds: chord needs both spans, strum needs vertical span", () => {
    const box = (w: number, h: number) => ({ left: 0, top: 0, right: w, bottom: h });
    expect(usableChordRange(box(MIN_CHORD_SPAN, MIN_CHORD_SPAN))).not.toBeNull();
    expect(usableChordRange(box(MIN_CHORD_SPAN - 0.01, 0.5))).toBeNull();
    expect(usableChordRange(box(0.5, MIN_CHORD_SPAN - 0.01))).toBeNull();
    expect(usableStrumRange(box(0.02, MIN_STRUM_SPAN))).not.toBeNull(); // narrow is fine
    expect(usableStrumRange(box(0.5, MIN_STRUM_SPAN - 0.01))).toBeNull();
    expect(usableChordRange(null)).toBeNull();
    expect(usableStrumRange(null)).toBeNull();
  });
});

describe("validateCalibration applies the movement thresholds", () => {
  it("a stored resting-hand calibration loads as 'none' (default zones)", () => {
    const stored = {
      version: 1,
      chord: { left: 0.34, top: 0.91, right: 0.36, bottom: 0.93 },
      strum: { left: 0.59, top: 0.92, right: 0.61, bottom: 0.94 },
      leftHanded: false,
    };
    expect(validateCalibration(stored)).toBeNull();
  });
  it("keeps the usable hand and drops the unusable one", () => {
    const stored = {
      version: 1,
      chord: { left: 0.1, top: 0.3, right: 0.4, bottom: 0.9 },
      strum: { left: 0.59, top: 0.92, right: 0.61, bottom: 0.94 },
    };
    const c = validateCalibration(stored)!;
    expect(c.chord).not.toBeNull();
    expect(c.strum).toBeNull();
  });
});
