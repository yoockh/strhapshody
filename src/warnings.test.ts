import { describe, expect, it } from "vitest";
import {
  meanLuma,
  nearFrameEdge,
  rawConditions,
  WARNING_PRIORITY,
  warningMessage,
  WarningMonitor,
  type TrackingSample,
} from "./warnings.ts";

const both = (score = 0.9, edge = false): TrackingSample => ({
  luma: 0.5,
  hands: [
    { role: "chord", score, nearEdge: edge },
    { role: "strum", score, nearEdge: false },
  ],
});

describe("rawConditions", () => {
  it("is empty for a healthy frame", () => {
    expect(rawConditions(both()).size).toBe(0);
  });
  it("flags a dark frame, but not an unsampled one", () => {
    expect(rawConditions({ ...both(), luma: 0.05 }).has("dark")).toBe(true);
    expect(rawConditions({ ...both(), luma: null }).has("dark")).toBe(false);
  });
  it("no hands is one warning, not two 'missing' ones", () => {
    const c = rawConditions({ luma: 0.5, hands: [] });
    expect([...c]).toEqual(["noHands"]);
  });
  it("one hand present flags the other as missing", () => {
    const c = rawConditions({ luma: 0.5, hands: [{ role: "strum", score: 0.9, nearEdge: false }] });
    expect(c.has("chordMissing")).toBe(true);
    expect(c.has("strumMissing")).toBe(false);
  });
  it("flags low confidence and edges", () => {
    expect(rawConditions(both(0.3)).has("lowConfidence")).toBe(true);
    expect(rawConditions(both(0.9, true)).has("chordEdge")).toBe(true);
  });
  it("dark can combine with no hands", () => {
    const c = rawConditions({ luma: 0.02, hands: [] });
    expect(c.has("dark") && c.has("noHands")).toBe(true);
  });
});

describe("WarningMonitor", () => {
  const dark: TrackingSample = { ...both(), luma: 0.05 };

  it("needs the condition to hold for the onset time", () => {
    const m = new WarningMonitor();
    expect(m.update(0, dark)).toEqual([]);
    expect(m.update(0.5, dark)).toEqual([]);
    expect(m.update(1.01, dark)).toEqual(["dark"]);
  });
  it("a single bad frame never shows a banner", () => {
    const m = new WarningMonitor();
    m.update(0, both());
    m.update(0.1, dark);
    for (let t = 0.2; t < 3; t += 0.1) expect(m.update(t, both())).toEqual([]);
  });
  it("hides only after the release time, so it doesn't flicker", () => {
    const m = new WarningMonitor();
    for (let t = 0; t <= 1.2; t += 0.1) m.update(t, dark);
    expect(m.active()).toEqual(["dark"]);
    // flicker clear/dark/clear quickly: stays shown
    expect(m.update(1.3, both())).toEqual(["dark"]);
    expect(m.update(1.4, dark)).toEqual(["dark"]);
    expect(m.update(1.5, both())).toEqual(["dark"]);
    expect(m.update(1.9, both())).toEqual(["dark"]);
    expect(m.update(2.11, both())).toEqual([]);
  });
  it("returns warnings in priority order", () => {
    const m = new WarningMonitor();
    const bad: TrackingSample = { luma: 0.05, hands: [{ role: "strum", score: 0.2, nearEdge: true }] };
    for (let t = 0; t <= 1.1; t += 0.1) m.update(t, bad);
    const a = m.active();
    expect(a).toEqual(["dark", "lowConfidence", "chordMissing", "strumEdge"]);
    expect(a).toEqual(WARNING_PRIORITY.filter((k) => a.includes(k)));
  });
  it("reset clears everything", () => {
    const m = new WarningMonitor();
    for (let t = 0; t <= 1.2; t += 0.1) m.update(t, dark);
    m.reset();
    expect(m.active()).toEqual([]);
    expect(m.update(1.3, dark)).toEqual([]);
  });
});

describe("warningMessage", () => {
  it("has text for every kind and names hands by handedness", () => {
    for (const k of WARNING_PRIORITY) expect(warningMessage(k).length).toBeGreaterThan(5);
    expect(warningMessage("chordMissing")).toMatch(/^Left hand/);
    expect(warningMessage("chordMissing", true)).toMatch(/^Right hand/);
    expect(warningMessage("strumEdge", true)).toMatch(/^Left hand/);
  });
});

describe("meanLuma", () => {
  it("black is 0, white is 1, empty is 0", () => {
    expect(meanLuma([0, 0, 0, 255, 0, 0, 0, 255])).toBe(0);
    expect(meanLuma([255, 255, 255, 255])).toBeCloseTo(1, 10);
    expect(meanLuma([])).toBe(0);
  });
  it("weights green most (Rec.601)", () => {
    expect(meanLuma([0, 255, 0, 255])).toBeCloseTo(0.587, 6);
    expect(meanLuma([0, 0, 255, 255])).toBeCloseTo(0.114, 6);
  });
  it("averages pixels", () => {
    expect(meanLuma([255, 255, 255, 255, 0, 0, 0, 255])).toBeCloseTo(0.5, 6);
  });
});

describe("nearFrameEdge", () => {
  it("detects points at or past any edge", () => {
    expect(nearFrameEdge([{ x: 0.5, y: 0.5 }])).toBe(false);
    expect(nearFrameEdge([{ x: 0.5, y: 0.5 }, { x: 0.01, y: 0.5 }])).toBe(true);
    expect(nearFrameEdge([{ x: 0.5, y: 0.995 }])).toBe(true);
    expect(nearFrameEdge([{ x: 1.2, y: 0.5 }])).toBe(true);
    expect(nearFrameEdge([{ x: 0.5, y: -0.1 }])).toBe(true);
    expect(nearFrameEdge([])).toBe(false);
  });
  it("respects a custom margin", () => {
    expect(nearFrameEdge([{ x: 0.08, y: 0.5 }], 0.1)).toBe(true);
    expect(nearFrameEdge([{ x: 0.08, y: 0.5 }], 0.05)).toBe(false);
  });
});
