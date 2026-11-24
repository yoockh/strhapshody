/**
 * Tracking-health warning banners (task 6.3 / PRD §11, §13).
 *
 * Hand tracking fails quietly: in a dark room MediaPipe's confidence drops
 * and hands flicker, and a hand drifting off the edge of the frame just
 * vanishes. Without feedback the player blames the app. This module turns
 * per-frame signals into a short, stable list of warnings:
 *
 * - **dark** — mean luminance of the camera frame below a threshold;
 * - **lowConfidence** — hands are found but MediaPipe's handedness scores
 *   are low (a proxy for "unsure what it's looking at");
 * - **noHands** — tracking is running but no hand is in view;
 * - **chordMissing / strumMissing** — one hand is in view, the other isn't;
 * - **chordEdge / strumEdge** — a hand is touching the edge of the visible
 *   frame (it's about to be cropped / lost).
 *
 * Each condition must hold for `onset` seconds before its banner shows and be
 * clear for `release` seconds before it hides, so a single bad frame never
 * flashes a banner and a banner never flickers. Pure + unit-tested
 * (ADR-0002); `main.ts` samples the frame and `drawWarningBanners` is thin
 * canvas glue.
 */

import type { HandRole } from "./handedness.ts";

export type WarningKind =
  | "dark"
  | "lowConfidence"
  | "noHands"
  | "chordMissing"
  | "strumMissing"
  | "chordEdge"
  | "strumEdge";

/** Display priority, most important first. */
export const WARNING_PRIORITY: readonly WarningKind[] = [
  "dark",
  "lowConfidence",
  "noHands",
  "chordMissing",
  "strumMissing",
  "chordEdge",
  "strumEdge",
];

/** One frame's tracking signals. */
export interface TrackingSample {
  /** Mean frame luminance in [0,1], or null if not sampled (yet). */
  readonly luma: number | null;
  /** Hands in view this frame. */
  readonly hands: ReadonlyArray<{
    readonly role: HandRole;
    /** MediaPipe handedness confidence [0,1]. */
    readonly score: number;
    /** Any landmark touching the edge of the visible frame. */
    readonly nearEdge: boolean;
  }>;
}

export interface WarningThresholds {
  /** Mean luma below this is "too dark". */
  readonly darkLuma: number;
  /** Mean hand score below this is "low confidence". */
  readonly minScore: number;
  /** Seconds a condition must hold before showing. */
  readonly onset: number;
  /** Seconds a condition must be clear before hiding. */
  readonly release: number;
}

export const DEFAULT_THRESHOLDS: WarningThresholds = {
  darkLuma: 0.15,
  minScore: 0.55,
  onset: 1.0,
  release: 0.6,
};

/** The conditions true in this one frame (no timing). */
export function rawConditions(
  sample: TrackingSample,
  th: WarningThresholds = DEFAULT_THRESHOLDS,
): Set<WarningKind> {
  const out = new Set<WarningKind>();
  if (sample.luma !== null && Number.isFinite(sample.luma) && sample.luma < th.darkLuma) {
    out.add("dark");
  }
  const hands = sample.hands;
  if (hands.length === 0) {
    out.add("noHands");
    return out;
  }
  const mean = hands.reduce((a, h) => a + (Number.isFinite(h.score) ? h.score : 0), 0) / hands.length;
  if (mean < th.minScore) out.add("lowConfidence");
  const chord = hands.find((h) => h.role === "chord");
  const strum = hands.find((h) => h.role === "strum");
  if (!chord) out.add("chordMissing");
  if (!strum) out.add("strumMissing");
  if (chord?.nearEdge) out.add("chordEdge");
  if (strum?.nearEdge) out.add("strumEdge");
  return out;
}

/** Debounces raw conditions into stable, prioritised warnings. */
export class WarningMonitor {
  private readonly th: WarningThresholds;
  /** When each condition last became true (while it stays true). */
  private readonly since = new Map<WarningKind, number>();
  /** When each shown warning last saw its condition true. */
  private readonly lastTrue = new Map<WarningKind, number>();
  private readonly shown = new Set<WarningKind>();

  constructor(th: WarningThresholds = DEFAULT_THRESHOLDS) {
    this.th = th;
  }

  /** Advance to time `t` (seconds) with this frame's sample. */
  update(t: number, sample: TrackingSample): WarningKind[] {
    const now = Number.isFinite(t) ? t : 0;
    const raw = rawConditions(sample, this.th);
    for (const kind of WARNING_PRIORITY) {
      if (raw.has(kind)) {
        if (!this.since.has(kind)) this.since.set(kind, now);
        this.lastTrue.set(kind, now);
        if (now - this.since.get(kind)! >= this.th.onset) this.shown.add(kind);
      } else {
        this.since.delete(kind);
        if (this.shown.has(kind) && now - (this.lastTrue.get(kind) ?? now) >= this.th.release) {
          this.shown.delete(kind);
        }
      }
    }
    return this.active();
  }

  /** Currently shown warnings, most important first. */
  active(): WarningKind[] {
    return WARNING_PRIORITY.filter((k) => this.shown.has(k));
  }

  /** Clear all state (e.g. while calibrating or when tracking restarts). */
  reset(): void {
    this.since.clear();
    this.lastTrue.clear();
    this.shown.clear();
  }
}

/** Banner text for a warning, naming the right hand for the handedness. */
export function warningMessage(kind: WarningKind, leftHanded = false): string {
  const chordHand = leftHanded ? "Right" : "Left";
  const strumHand = leftHanded ? "Left" : "Right";
  switch (kind) {
    case "dark":
      return "Too dark — turn on a light or face a window";
    case "lowConfidence":
      return "Tracking is unsure — add light or use a plainer background";
    case "noHands":
      return "Raise both hands into view";
    case "chordMissing":
      return `${chordHand} hand not detected — bring it into view`;
    case "strumMissing":
      return `${strumHand} hand not detected — bring it into view`;
    case "chordEdge":
      return `${chordHand} hand is at the edge of the frame — move it inward`;
    case "strumEdge":
      return `${strumHand} hand is at the edge of the frame — move it inward`;
  }
}

/**
 * Mean Rec.601 luma of RGBA pixel data, in [0,1]. Empty input → 0.
 * (Alpha is ignored; camera frames are opaque.)
 */
export function meanLuma(rgba: ArrayLike<number>): number {
  const n = Math.floor(rgba.length / 4);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    sum += 0.299 * rgba[o]! + 0.587 * rgba[o + 1]! + 0.114 * rgba[o + 2]!;
  }
  return sum / n / 255;
}

/**
 * Whether any point lies within `margin` of the edge of the visible frame.
 * Points are normalised to the canvas (0..1); points outside it count too.
 */
export function nearFrameEdge(
  points: ReadonlyArray<{ x: number; y: number }>,
  margin = 0.02,
): boolean {
  return points.some(
    (p) => p.x < margin || p.x > 1 - margin || p.y < margin || p.y > 1 - margin,
  );
}

/** At most this many banners at once (the most important ones). */
export const MAX_BANNERS = 2;

/** Draw the warning banners, bottom-centre, stacked upward (canvas glue). */
export function drawWarningBanners(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kinds: readonly WarningKind[],
  leftHanded = false,
): void {
  const shown = kinds.slice(0, MAX_BANNERS);
  if (shown.length === 0) return;
  const fontSize = Math.max(12, Math.round(height * 0.024));
  const padX = fontSize;
  const h = fontSize * 2.1;
  ctx.save();
  ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let y = height - h - Math.max(12, height * 0.03);
  for (const kind of shown) {
    const text = `⚠  ${warningMessage(kind, leftHanded)}`;
    const w = Math.min(width - 24, ctx.measureText(text).width + padX * 2);
    const x = (width - w) / 2;
    ctx.fillStyle = "rgba(40, 26, 6, 0.9)";
    ctx.strokeStyle = "#e8a13a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffd28a";
    ctx.fillText(text, width / 2, y + h / 2, w - padX);
    y -= h + 8;
  }
  ctx.restore();
}
