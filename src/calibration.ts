/**
 * First-run calibration (task 6.1 / PRD §11 "calibration").
 *
 * A ~20 s guided flow that records where each hand comfortably moves and
 * resizes the play zones to match: the left zone (power strip + hex flower)
 * is fitted to the left hand's range, the string band to the right hand's.
 * People sit at different distances and have different reach, so fixed
 * half-screen zones are either cramped or require stretching.
 *
 * Flow: intro (3 s, get both hands up) → chord (8 s, roam the chord hand over
 * the area you'd use for chords) → strum (8 s, strum the other hand through
 * its full comfortable range) → done (1.5 s summary). Esc cancels. The chord
 * hand is the left hand, or the right one for left-handed players (6.2).
 *
 * Everything decision-making is pure and unit-tested (ADR-0002):
 * `CalibrationSession` (the timed state machine + sample collection),
 * `robustRange` (5th–95th percentile box, so a stray frame can't blow up a
 * zone), `calibratedZones` (normalised ranges → canvas rects with padding,
 * minimum sizes and clamping) and `validateCalibration` (localStorage input).
 * `drawCalibrationOverlay` is thin canvas glue.
 *
 * Coordinates are stored **normalised** to the canvas (0..1, x after the
 * mirror, i.e. as the user sees it), so a calibration survives resizes.
 */

import type { Rect } from "./powerstrip.ts";

/** A normalised [0,1]² box. */
export interface NormBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Saved calibration: the chord hand's and the strum hand's comfortable range
 * (either may be absent), and whether it was recorded left-handed — if the
 * handedness setting changes later the boxes are mirrored rather than lost.
 */
export interface Calibration {
  readonly version: 1;
  readonly chord: NormBox | null;
  readonly strum: NormBox | null;
  readonly leftHanded?: boolean;
}

export const CALIBRATION_STORAGE_KEY = "strhapshody.calibration.v1";

export type CalibrationPhase = "intro" | "chord" | "strum" | "done";

/** Phase lengths in seconds (total 20.5 s). */
export const PHASE_SECONDS: Readonly<Record<CalibrationPhase, number>> = {
  intro: 3,
  chord: 8,
  strum: 8,
  done: 1.5,
};
const PHASE_ORDER: readonly CalibrationPhase[] = ["intro", "chord", "strum", "done"];

/** Fewer samples than this for a hand → keep that hand's default zone. */
export const MIN_SAMPLES = 30;
/** Samples needed before the live range box is drawn. */
const LIVE_MIN_SAMPLES = 8;

/** What the overlay needs to draw this frame. */
export interface CalibrationView {
  readonly phase: CalibrationPhase;
  /** 0..1 progress through the current phase. */
  readonly progress: number;
  /** Whole seconds left in the current phase (rounded up). */
  readonly secondsLeft: number;
  /** Live range of the hand being recorded (null until enough samples). */
  readonly liveBox: NormBox | null;
  /** True once the flow has finished (after the done phase). */
  readonly finished: boolean;
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/**
 * The 5th–95th-percentile box of a set of normalised points, clamped to
 * [0,1]. `null` for fewer than `minSamples` finite points.
 */
export function robustRange(
  points: ReadonlyArray<{ x: number; y: number }>,
  minSamples = MIN_SAMPLES,
): NormBox | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      xs.push(p.x);
      ys.push(p.y);
    }
  }
  if (xs.length < Math.max(1, minSamples)) return null;
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  const c = (v: number): number => Math.min(1, Math.max(0, v));
  return {
    left: c(percentile(xs, 0.05)),
    right: c(percentile(xs, 0.95)),
    top: c(percentile(ys, 0.05)),
    bottom: c(percentile(ys, 0.95)),
  };
}

/**
 * The timed calibration state machine. Feed it a timestamp (seconds) and the
 * current normalised palm position of each hand (or null) every frame; it
 * records the chord hand during the chord phase and the strum hand during the
 * strum phase.
 */
export class CalibrationSession {
  private readonly start: number;
  private readonly chordSamples: { x: number; y: number }[] = [];
  private readonly strumSamples: { x: number; y: number }[] = [];
  private lastView: CalibrationView;

  constructor(startSeconds: number) {
    this.start = Number.isFinite(startSeconds) ? startSeconds : 0;
    this.lastView = {
      phase: "intro",
      progress: 0,
      secondsLeft: PHASE_SECONDS.intro,
      liveBox: null,
      finished: false,
    };
  }

  /** Advance to time `t` and record samples; returns what to draw. */
  update(
    t: number,
    chord: { x: number; y: number } | null,
    strum: { x: number; y: number } | null,
  ): CalibrationView {
    const elapsed = Number.isFinite(t) ? Math.max(0, t - this.start) : 0;
    let acc = 0;
    let phase: CalibrationPhase = "done";
    let inPhase = PHASE_SECONDS.done;
    let finished = true;
    for (const p of PHASE_ORDER) {
      if (elapsed < acc + PHASE_SECONDS[p]) {
        phase = p;
        inPhase = elapsed - acc;
        finished = false;
        break;
      }
      acc += PHASE_SECONDS[p];
    }
    if (phase === "chord" && chord) this.chordSamples.push(chord);
    if (phase === "strum" && strum) this.strumSamples.push(strum);

    const len = PHASE_SECONDS[phase];
    // Live feedback box for the hand being recorded (fewer samples needed
    // than for the final result, so it appears quickly).
    const samples =
      phase === "chord" ? this.chordSamples : phase === "strum" ? this.strumSamples : null;
    this.lastView = {
      phase,
      progress: finished ? 1 : Math.min(1, inPhase / len),
      secondsLeft: finished ? 0 : Math.ceil(len - inPhase),
      liveBox: samples ? robustRange(samples, LIVE_MIN_SAMPLES) : null,
      finished,
    };
    return this.lastView;
  }

  /** The last view returned by `update`. */
  get view(): CalibrationView {
    return this.lastView;
  }

  /** Number of samples recorded per hand so far. */
  get sampleCounts(): { chord: number; strum: number } {
    return { chord: this.chordSamples.length, strum: this.strumSamples.length };
  }

  /** The calibration from what was recorded (either hand may be null). */
  result(leftHanded = false): Calibration {
    return {
      version: 1,
      chord: robustRange(this.chordSamples),
      strum: robustRange(this.strumSamples),
      leftHanded,
    };
  }
}

function validBox(raw: unknown): NormBox | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const vals = [r.left, r.top, r.right, r.bottom];
  if (!vals.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1)) {
    return null;
  }
  const [left, top, right, bottom] = vals as number[];
  if (!(right! > left!) || !(bottom! > top!)) return null;
  return { left: left!, top: top!, right: right!, bottom: bottom! };
}

/** Validate a stored calibration (from JSON); `null` if unusable. */
export function validateCalibration(raw: unknown): Calibration | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  if (r.leftHanded !== undefined && typeof r.leftHanded !== "boolean") return null;
  const chord = r.chord === null ? null : validBox(r.chord);
  const strum = r.strum === null ? null : validBox(r.strum);
  if ((r.chord !== null && !chord) || (r.strum !== null && !strum)) return null;
  if (!chord && !strum) return null;
  return { version: 1, chord, strum, leftHanded: r.leftHanded === true };
}

/** Canvas-pixel play zones. */
export interface PlayZones {
  /** Rect the chord layout (power strip + hex flower) is fitted into. */
  readonly chord: Rect;
  /** Rect the six strings span (x for drawing, y for the strum detector). */
  readonly strum: Rect;
}

/** Fraction of the box size added on each side as breathing room. */
const PAD = 0.15;
/** Minimum zone size as a fraction of its half of the screen (w, h). */
const MIN_CHORD = { w: 0.55, h: 0.6 };
const MIN_STRUM = { w: 0.5, h: 0.45 };

/** Grow [lo,hi] around its centre to at least `min`, then fit inside [a,b]. */
function fitSpan(lo: number, hi: number, min: number, a: number, b: number): [number, number] {
  const avail = b - a;
  const size = Math.min(avail, Math.max(hi - lo, min));
  let c = (lo + hi) / 2;
  c = Math.min(b - size / 2, Math.max(a + size / 2, c));
  return [c - size / 2, c + size / 2];
}

function zoneFromBox(
  box: NormBox,
  width: number,
  height: number,
  bounds: Rect,
  min: { w: number; h: number },
): Rect {
  const bw = (box.right - box.left) * width;
  const bh = (box.bottom - box.top) * height;
  const lo = { x: box.left * width - bw * PAD, y: box.top * height - bh * PAD };
  const hi = { x: box.right * width + bw * PAD, y: box.bottom * height + bh * PAD };
  const [left, right] = fitSpan(
    lo.x,
    hi.x,
    (bounds.right - bounds.left) * min.w,
    bounds.left,
    bounds.right,
  );
  const [top, bottom] = fitSpan(
    lo.y,
    hi.y,
    (bounds.bottom - bounds.top) * min.h,
    bounds.top,
    bounds.bottom,
  );
  return { left, top, right, bottom };
}

/** A box mirrored left↔right (x → 1 − x). */
export function mirrorBox(b: NormBox): NormBox {
  return { left: 1 - b.right, top: b.top, right: 1 - b.left, bottom: b.bottom };
}

/**
 * Play zones for a `width × height` canvas with the status bar `barH` tall.
 * The chord zone lives in the left half (right half when `leftHanded`), the
 * strings in the other. Without calibration (or for a hand without a recorded
 * range) a zone is its whole half below the bar — the pre-calibration layout.
 * With one, the zone is the hand's range padded by 15% per side, grown to a
 * minimum size so it stays playable, and clamped inside its half so the two
 * never overlap. A calibration recorded with the other handedness is mirrored.
 */
export function calibratedZones(
  calib: Calibration | null,
  width: number,
  height: number,
  barH: number,
  leftHanded = false,
): PlayZones {
  const w = Number.isFinite(width) && width > 0 ? width : 1;
  const h = Number.isFinite(height) && height > 0 ? height : 1;
  const top = Math.min(h, Math.max(0, Number.isFinite(barH) ? barH : 0));
  const leftHalf: Rect = { left: 0, top, right: w / 2, bottom: h };
  const rightHalf: Rect = { left: w / 2, top, right: w, bottom: h };
  const chordHalf = leftHanded ? rightHalf : leftHalf;
  const strumHalf = leftHanded ? leftHalf : rightHalf;
  const flip = (calib?.leftHanded ?? false) !== leftHanded;
  const box = (b: NormBox | null | undefined): NormBox | null =>
    b ? (flip ? mirrorBox(b) : b) : null;
  const chordBox = box(calib?.chord);
  const strumBox = box(calib?.strum);
  return {
    chord: chordBox ? zoneFromBox(chordBox, w, h, chordHalf, MIN_CHORD) : chordHalf,
    strum: strumBox ? zoneFromBox(strumBox, w, h, strumHalf, MIN_STRUM) : strumHalf,
  };
}

/** Overlay title + instruction for a phase, worded for the player's handedness. */
export function calibrationPrompt(
  phase: CalibrationPhase,
  leftHanded = false,
): readonly [string, string] {
  const chordHand = leftHanded ? "right" : "left";
  const strumHand = leftHanded ? "left" : "right";
  switch (phase) {
    case "intro":
      return [
        "Calibration",
        `Raise both hands into view — ${chordHand} for chords, ${strumHand} for strumming.`,
      ];
    case "chord":
      return [
        `${chordHand === "left" ? "Left" : "Right"} hand`,
        `Move your ${chordHand} hand around the area you'd comfortably reach for chords.`,
      ];
    case "strum":
      return [
        `${strumHand === "left" ? "Left" : "Right"} hand`,
        `Strum your ${strumHand} hand up and down through its full comfortable range.`,
      ];
    default:
      return ["Done", "Zones resized to your reach. Press the Calibrate button to redo it."];
  }
}

/** Draw the calibration overlay (thin canvas glue; not unit-tested). */
export function drawCalibrationOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: CalibrationView,
  leftHanded = false,
): void {
  ctx.save();
  ctx.fillStyle = "rgba(8, 10, 14, 0.55)";
  ctx.fillRect(0, 0, width, height);

  // Highlight the half being recorded.
  if (view.phase === "chord" || view.phase === "strum") {
    const chordOnLeft = !leftHanded;
    const onLeft = (view.phase === "chord") === chordOnLeft;
    const x = onLeft ? 0 : width / 2;
    ctx.fillStyle = "rgba(232, 161, 58, 0.10)";
    ctx.fillRect(x, 0, width / 2, height);
  }

  // Live range box.
  if (view.liveBox) {
    const b = view.liveBox;
    ctx.strokeStyle = "#e8a13a";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(b.left * width, b.top * height, (b.right - b.left) * width, (b.bottom - b.top) * height);
    ctx.setLineDash([]);
  }

  const [title, body] = calibrationPrompt(view.phase, leftHanded);
  const cx = width / 2;
  const cy = height * 0.42;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e8eaed";
  ctx.font = `700 ${Math.round(Math.max(18, height * 0.05))}px system-ui, sans-serif`;
  ctx.fillText(view.secondsLeft > 0 ? `${title} · ${view.secondsLeft}` : title, cx, cy);
  ctx.font = `500 ${Math.round(Math.max(12, height * 0.024))}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(232, 234, 237, 0.85)";
  ctx.fillText(body, cx, cy + height * 0.06);
  ctx.font = `500 ${Math.round(Math.max(10, height * 0.018))}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(232, 234, 237, 0.55)";
  ctx.fillText("Esc to cancel", cx, cy + height * 0.1);

  // Progress bar.
  const bw = Math.min(width * 0.4, 420);
  const bx = cx - bw / 2;
  const by = cy + height * 0.14;
  ctx.fillStyle = "rgba(232, 234, 237, 0.15)";
  ctx.fillRect(bx, by, bw, 6);
  ctx.fillStyle = "#e8a13a";
  ctx.fillRect(bx, by, bw * view.progress, 6);
  ctx.restore();
}
