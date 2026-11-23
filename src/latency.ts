/**
 * Strum latency measurement (task 7.2 / PRD §10: < 100 ms, ideally < 60 ms).
 *
 * At every strum boundary the app records a `LatencySample`: when the strum
 * was detected (performance clock), how long the JS work took (commit,
 * voicing, Karplus-Strong render, scheduling), the audio-clock time the first
 * voice was scheduled for, and an `AudioContext.getOutputTimestamp()` reading
 * taken right after. That timestamp pairs an audio-clock time with the
 * performance-clock time at which that sample reaches the output device, so
 * the moment the first voice becomes *audible* can be expressed on the
 * performance clock — including the device's output buffering — and compared
 * with the detection time. When the browser can't provide a usable output
 * timestamp, the estimate falls back to scheduling delay + `baseLatency +
 * outputLatency`.
 *
 * For hand strums the frame's camera `captureTime` (from
 * `requestVideoFrameCallback`) is recorded too, giving an **end-to-end**
 * figure (light hits the sensor → sound leaves the speakers) that includes
 * camera, MediaPipe inference and frame scheduling. That can only be measured
 * on a machine with a camera; here the keyboard path measures the
 * detection → audio part.
 *
 * Pure and unit-tested (ADR-0002); `main.ts` collects samples, the e2e
 * harness (`e2e/latency.spec.ts`) drives and reports them.
 */

/** What the app records for one strum. Times in ms unless noted. */
export interface LatencySample {
  readonly source: "hand" | "keyboard";
  /** performance.now() when the strum was detected. */
  readonly detectMs: number;
  /** performance.now() after the voices were scheduled. */
  readonly scheduledMs: number;
  /** Camera capture time of the frame the strum was detected on (hand only). */
  readonly captureMs: number | null;
  /** Audio-clock time (seconds) the first voice was scheduled to start. */
  readonly voiceCtxTime: number;
  /** Audio-clock time (seconds) when `scheduledMs` was taken. */
  readonly ctxTimeAtSchedule: number;
  /** getOutputTimestamp() taken at `scheduledMs`, if available. */
  readonly outputTimestamp: { readonly contextTime: number; readonly performanceTime: number } | null;
  /** AudioContext baseLatency + outputLatency, seconds. */
  readonly reportedLatency: number;
}

/** Whether an output timestamp is usable (browsers report zeros when idle/unsupported). */
function usableTimestamp(ts: LatencySample["outputTimestamp"]): ts is {
  contextTime: number;
  performanceTime: number;
} {
  return (
    ts !== null &&
    Number.isFinite(ts.contextTime) &&
    Number.isFinite(ts.performanceTime) &&
    ts.contextTime > 0 &&
    ts.performanceTime > 0
  );
}

/**
 * Performance-clock time (ms) at which the first voice is heard. Via the
 * output timestamp when usable, else scheduling delay + reported latency.
 * Never earlier than `scheduledMs` (a voice can't sound before it exists).
 */
export function audibleMs(s: LatencySample): number {
  let t: number;
  if (usableTimestamp(s.outputTimestamp)) {
    t = s.outputTimestamp.performanceTime + (s.voiceCtxTime - s.outputTimestamp.contextTime) * 1000;
  } else {
    const ahead = Math.max(0, s.voiceCtxTime - s.ctxTimeAtSchedule);
    const reported = Number.isFinite(s.reportedLatency) ? Math.max(0, s.reportedLatency) : 0;
    t = s.scheduledMs + (ahead + reported) * 1000;
  }
  return Math.max(t, s.scheduledMs);
}

/** Detection → audible, ms (the part this app controls, plus device output). */
export function strumLatencyMs(s: LatencySample): number {
  return audibleMs(s) - s.detectMs;
}

/** JS processing time for the strum (detect → voices scheduled), ms. */
export function processingMs(s: LatencySample): number {
  return Math.max(0, s.scheduledMs - s.detectMs);
}

/** Camera capture → audible, ms, or null without a capture time. */
export function endToEndLatencyMs(s: LatencySample): number | null {
  if (s.captureMs === null || !Number.isFinite(s.captureMs)) return null;
  return audibleMs(s) - s.captureMs;
}

export interface LatencySummary {
  readonly n: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
  readonly mean: number;
}

/** Nearest-rank percentile of a sorted array (p in [0,1]). */
function nearestRank(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil(p * sorted.length));
  return sorted[rank - 1]!;
}

/** p50 / p95 / max / mean of the finite values; null when there are none. */
export function summarize(values: readonly number[]): LatencySummary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return {
    n: v.length,
    p50: nearestRank(v, 0.5),
    p95: nearestRank(v, 0.95),
    max: v[v.length - 1]!,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
  };
}

/** PRD §10 latency targets, ms. */
export const LATENCY_TARGET_MS = 100;
export const LATENCY_IDEAL_MS = 60;

/** How a p95 compares with the PRD targets. */
export function latencyVerdict(p95: number): "ideal" | "within target" | "too slow" {
  if (p95 < LATENCY_IDEAL_MS) return "ideal";
  if (p95 < LATENCY_TARGET_MS) return "within target";
  return "too slow";
}

/** Keeps the most recent `capacity` samples. */
export class LatencyLog {
  private readonly capacity: number;
  private readonly items: LatencySample[] = [];

  constructor(capacity = 200) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  add(sample: LatencySample): void {
    this.items.push(sample);
    if (this.items.length > this.capacity) this.items.shift();
  }

  samples(): readonly LatencySample[] {
    return this.items;
  }

  /** Summaries of strum and (hand-only) end-to-end latency, plus processing time. */
  report(): {
    strum: LatencySummary | null;
    endToEnd: LatencySummary | null;
    processing: LatencySummary | null;
  } {
    return {
      strum: summarize(this.items.map(strumLatencyMs)),
      endToEnd: summarize(
        this.items.map(endToEndLatencyMs).filter((x): x is number => x !== null),
      ),
      processing: summarize(this.items.map(processingMs)),
    };
  }
}
