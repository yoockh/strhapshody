import { describe, expect, it } from "vitest";
import {
  calibratedZones,
  CalibrationSession,
  MIN_SAMPLES,
  PHASE_SECONDS,
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
    expect(s.update(100 + PHASE_SECONDS.intro + 0.1, L, R).phase).toBe("left");
    const tRight = 100 + PHASE_SECONDS.intro + PHASE_SECONDS.left + 0.1;
    expect(s.update(tRight, L, R).phase).toBe("right");
    const tDone = tRight + PHASE_SECONDS.right;
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
    const { left, right } = s.sampleCounts;
    expect(left).toBeGreaterThan(PHASE_SECONDS.left * fps - 3);
    expect(left).toBeLessThan(PHASE_SECONDS.left * fps + 3);
    expect(right).toBeGreaterThan(PHASE_SECONDS.right * fps - 3);
    expect(right).toBeLessThan(PHASE_SECONDS.right * fps + 3);
  });

  it("produces each hand's range; a missing hand stays null", () => {
    const s = new CalibrationSession(0);
    const leftPts = grid(0.1, 0.3, 0.35, 0.85, 16);
    let i = 0;
    for (let f = 0; f < 21 * 30; f++) {
      s.update(f / 30, leftPts[i++ % leftPts.length]!, null);
    }
    const c = s.result();
    expect(c.left).not.toBeNull();
    expect(c.left!.left).toBeCloseTo(0.1, 1);
    expect(c.right).toBeNull();
  });

  it("reports progress and a countdown, and a live box once sampling", () => {
    const s = new CalibrationSession(0);
    const v0 = s.update(0, null, null);
    expect(v0.secondsLeft).toBe(PHASE_SECONDS.intro);
    expect(v0.liveBox).toBeNull();
    const pts = grid(0.1, 0.3, 0.3, 0.6, 4);
    let v = v0;
    for (let k = 0; k < 16; k++) v = s.update(PHASE_SECONDS.intro + k / 30, pts[k]!, null);
    expect(v.phase).toBe("left");
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
    left: { left: 0.1, top: 0.3, right: 0.4, bottom: 0.9 },
    right: null,
  };
  it("accepts a good calibration (one hand may be null)", () => {
    expect(validateCalibration(JSON.parse(JSON.stringify(good)))).toEqual(good);
  });
  it("rejects garbage, wrong versions, inverted or out-of-range boxes, and all-null", () => {
    expect(validateCalibration(null)).toBeNull();
    expect(validateCalibration("x")).toBeNull();
    expect(validateCalibration({ ...good, version: 2 })).toBeNull();
    expect(validateCalibration({ ...good, left: { left: 0.5, top: 0.3, right: 0.4, bottom: 0.9 } })).toBeNull();
    expect(validateCalibration({ ...good, left: { left: 0.1, top: 0.3, right: 1.4, bottom: 0.9 } })).toBeNull();
    expect(validateCalibration({ ...good, left: { left: "0.1" } })).toBeNull();
    expect(validateCalibration({ version: 1, left: null, right: null })).toBeNull();
  });
});

describe("calibratedZones", () => {
  it("without calibration each zone is its half below the status bar", () => {
    const z = calibratedZones(null, W, H, BAR);
    expect(z.left).toEqual({ left: 0, top: BAR, right: W / 2, bottom: H });
    expect(z.right).toEqual({ left: W / 2, top: BAR, right: W, bottom: H });
  });

  it("fits zones to the recorded ranges, with padding", () => {
    const z = calibratedZones(
      {
        version: 1,
        left: { left: 0.05, top: 0.3, right: 0.4, bottom: 0.95 },
        right: { left: 0.6, top: 0.25, right: 0.95, bottom: 0.85 },
      },
      W,
      H,
      BAR,
    );
    // contains the raw range
    expect(z.left.left).toBeLessThanOrEqual(0.05 * W);
    expect(z.left.right).toBeGreaterThanOrEqual(0.4 * W);
    expect(z.right.top).toBeLessThanOrEqual(0.25 * H);
    expect(z.right.bottom).toBeGreaterThanOrEqual(0.85 * H);
    // but is smaller than the full half
    expect(z.right.bottom - z.right.top).toBeLessThan(H - BAR);
  });

  it("keeps each zone inside its half and below the bar", () => {
    const z = calibratedZones(
      {
        version: 1,
        left: { left: 0.3, top: 0.0, right: 0.7, bottom: 0.3 }, // strays right & under the bar
        right: { left: 0.4, top: 0.7, right: 1.0, bottom: 1.0 },
      },
      W,
      H,
      BAR,
    );
    expect(z.left.left).toBeGreaterThanOrEqual(0);
    expect(z.left.right).toBeLessThanOrEqual(W / 2);
    expect(z.left.top).toBeGreaterThanOrEqual(BAR);
    expect(z.right.left).toBeGreaterThanOrEqual(W / 2);
    expect(z.right.right).toBeLessThanOrEqual(W);
    expect(z.right.bottom).toBeLessThanOrEqual(H);
  });

  it("grows a tiny range to a playable minimum", () => {
    const z = calibratedZones(
      {
        version: 1,
        left: { left: 0.2, top: 0.5, right: 0.21, bottom: 0.51 },
        right: { left: 0.7, top: 0.5, right: 0.71, bottom: 0.51 },
      },
      W,
      H,
      BAR,
    );
    expect(z.left.right - z.left.left).toBeGreaterThanOrEqual((W / 2) * 0.55 - 1e-6);
    expect(z.left.bottom - z.left.top).toBeGreaterThanOrEqual((H - BAR) * 0.6 - 1e-6);
    expect(z.right.bottom - z.right.top).toBeGreaterThanOrEqual((H - BAR) * 0.45 - 1e-6);
  });

  it("uses the default half for a hand with no range", () => {
    const z = calibratedZones(
      { version: 1, left: null, right: { left: 0.6, top: 0.3, right: 0.9, bottom: 0.7 } },
      W,
      H,
      BAR,
    );
    expect(z.left).toEqual({ left: 0, top: BAR, right: W / 2, bottom: H });
  });

  it("survives degenerate canvas sizes", () => {
    const z = calibratedZones(null, 0, Number.NaN, Number.NaN);
    for (const r of [z.left, z.right]) {
      for (const v of [r.left, r.top, r.right, r.bottom]) expect(Number.isFinite(v)).toBe(true);
      expect(r.right).toBeGreaterThanOrEqual(r.left);
      expect(r.bottom).toBeGreaterThanOrEqual(r.top);
    }
  });
});
