import { describe, expect, it } from "vitest";
import {
  audibleMs,
  endToEndLatencyMs,
  LatencyLog,
  latencyVerdict,
  processingMs,
  strumLatencyMs,
  summarize,
  type LatencySample,
} from "./latency.ts";

const base: LatencySample = {
  source: "keyboard",
  detectMs: 1000,
  scheduledMs: 1002,
  captureMs: null,
  voiceCtxTime: 10.0,
  ctxTimeAtSchedule: 10.0,
  outputTimestamp: { contextTime: 9.98, performanceTime: 1005 },
  reportedLatency: 0.03,
};

describe("audibleMs", () => {
  it("maps the voice's audio-clock time through the output timestamp", () => {
    // voice is 20 ms of audio-clock after the sample presented at 1005 ms
    expect(audibleMs(base)).toBeCloseTo(1025, 6);
    expect(strumLatencyMs(base)).toBeCloseTo(25, 6);
  });
  it("falls back to scheduling delay + reported latency without a timestamp", () => {
    const s = { ...base, outputTimestamp: null, voiceCtxTime: 10.012 };
    expect(audibleMs(s)).toBeCloseTo(1002 + 12 + 30, 6);
  });
  it("treats an all-zero (idle/unsupported) timestamp as unavailable", () => {
    const s = { ...base, outputTimestamp: { contextTime: 0, performanceTime: 0 } };
    expect(audibleMs(s)).toBeCloseTo(1002 + 30, 6);
  });
  it("is never before the voices were scheduled", () => {
    const s = { ...base, outputTimestamp: { contextTime: 20, performanceTime: 1001 } };
    expect(audibleMs(s)).toBe(1002);
  });
  it("ignores a non-finite reported latency in the fallback", () => {
    const s = { ...base, outputTimestamp: null, reportedLatency: Number.NaN };
    expect(audibleMs(s)).toBe(1002);
  });
});

describe("processing and end-to-end", () => {
  it("processing is detect → scheduled", () => {
    expect(processingMs(base)).toBe(2);
    expect(processingMs({ ...base, scheduledMs: 990 })).toBe(0);
  });
  it("end-to-end needs a capture time", () => {
    expect(endToEndLatencyMs(base)).toBeNull();
    expect(endToEndLatencyMs({ ...base, source: "hand", captureMs: 950 })).toBeCloseTo(75, 6);
  });
});

describe("summarize", () => {
  it("nearest-rank percentiles, max and mean", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
    const s = summarize(v)!;
    expect(s.n).toBe(100);
    expect(s.p50).toBe(50);
    expect(s.p95).toBe(95);
    expect(s.max).toBe(100);
    expect(s.mean).toBeCloseTo(50.5, 10);
  });
  it("handles a single value, ignores non-finite, null when empty", () => {
    expect(summarize([7])!.p95).toBe(7);
    expect(summarize([3, Number.NaN, 5])!.n).toBe(2);
    expect(summarize([])).toBeNull();
  });
});

describe("latencyVerdict", () => {
  it("grades against the PRD targets", () => {
    expect(latencyVerdict(40)).toBe("ideal");
    expect(latencyVerdict(60)).toBe("within target");
    expect(latencyVerdict(99)).toBe("within target");
    expect(latencyVerdict(100)).toBe("too slow");
  });
});

describe("LatencyLog", () => {
  it("keeps the most recent samples and reports them", () => {
    const log = new LatencyLog(3);
    for (let i = 0; i < 5; i++) log.add({ ...base, detectMs: 1000 - i });
    expect(log.samples()).toHaveLength(3);
    expect(log.samples()[0]!.detectMs).toBe(998);
    const r = log.report();
    expect(r.strum!.n).toBe(3);
    expect(r.endToEnd).toBeNull();
    expect(r.processing!.n).toBe(3);
  });
});
