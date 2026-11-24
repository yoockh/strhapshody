/**
 * Power-chord strip UI + Chord/Power mode switch (task 4.2 / PRD §7).
 *
 * The strip *geometry* (fret-from-x, string-pair-from-y, fret-marker centres)
 * lives in the Rust/WASM `powerstrip` module (task 4.1, ADR-0013); this module
 * only lays the strip out inside the left zone, draws it, and owns the pure
 * Chord↔Power mode-switch rule the engine deliberately left to the frontend.
 * Following the ADR-0002 split it is two layers:
 *
 *  - PURE, unit-tested: `computeLeftZoneLayout` (carve a strip band off the top
 *    of the left zone and leave the rest for the hex flower), `rectContains`, and
 *    `nextPlayMode` (the hysteresis rule: enter Power on the strip, return to
 *    Chord in the hex area, hold the current mode in the neutral gap between).
 *  - A thin DOM `drawPowerStrip` wrapper (fret markers, inlay dots, the string-
 *    pair midline, a Power/Chord-aware accent, and the hovered fret column). It
 *    needs a real 2D context, so it's exercised by the e2e suite / a human.
 *
 * The engine owns the fret-marker x positions (`PowerStrip.fretMarkerX`); the
 * frontend passes those through here as plain numbers so this module never
 * touches the WASM package (keeps it node-testable), exactly like `hexflower.ts`.
 */

import type { CanvasPoint } from "./handoverlay.ts";

/** Which half of the app the left hand is driving (PRD §5 status bar). */
export type PlayMode = "Chord" | "Power";

/** An axis-aligned rectangle in canvas pixels. */
export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * The left zone split into the power-chord strip band (top) and the hex-flower
 * area (below it), with a neutral gap between them that the mode switch treats
 * as "hold the current mode" so the Chord↔Power boundary doesn't flicker.
 */
export interface LeftZoneLayout {
  /** The power-chord strip rectangle (build the WASM `PowerStrip` from this). */
  readonly strip: Rect;
  /** The rectangle left for the hex flower + the Chord-mode region. */
  readonly hexArea: Rect;
}

/** Clamp `x` to [lo, hi]; non-finite → lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * Split the left zone `[left,top]`–`[right,bottom]` (below the status bar) into
 * a power-strip band across the top and the hex-flower area below it.
 *
 * The strip is inset from the zone's left/right/top edges by `marginFraction` of
 * the zone's width/height and is `stripHeightFraction` of the zone height tall.
 * Below it a `gapFraction`-tall neutral band separates the strip from the hex
 * area (this is the mode-switch dead band — see `nextPlayMode`). All fractions
 * are clamped so a degenerate or absurd request still yields `left<right`,
 * `top<bottom` rectangles rather than NaN/inverted ones.
 */
export function computeLeftZoneLayout(
  left: number,
  top: number,
  right: number,
  bottom: number,
  stripHeightFraction = 0.17,
  marginFraction = 0.06,
  gapFraction = 0.04,
): LeftZoneLayout {
  const l = Number.isFinite(left) ? left : 0;
  const t = Number.isFinite(top) ? top : 0;
  const w = Math.max(0, (Number.isFinite(right) ? right : l) - l);
  const h = Math.max(0, (Number.isFinite(bottom) ? bottom : t) - t);
  const r = l + w;
  const b = t + h;

  const marginX = w * clamp(marginFraction, 0, 0.4);
  const marginY = h * clamp(marginFraction, 0, 0.3);
  const stripH = h * clamp(stripHeightFraction, 0.02, 0.5);
  const gap = h * clamp(gapFraction, 0, 0.2);

  const stripTop = t + marginY;
  const stripBottom = stripTop + stripH;
  const strip: Rect = {
    left: l + marginX,
    top: stripTop,
    right: r - marginX,
    bottom: stripBottom,
  };

  // The hex area is everything below the strip's neutral gap. Floor its top so
  // it can never cross the zone bottom (keeps top<bottom on a tiny zone).
  const hexTop = Math.min(stripBottom + gap, b);
  const hexArea: Rect = { left: l, top: hexTop, right: r, bottom: b };

  return { strip, hexArea };
}

/** `true` iff `(p.x, p.y)` is inside `rect` (edges inclusive); null → false. */
export function rectContains(rect: Rect, p: CanvasPoint | null): boolean {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  return (
    p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom
  );
}

/**
 * The Chord↔Power mode-switch rule (PRD §7: "entering [the strip] switches to
 * Power mode, returning to the hex area switches back to Chord mode").
 *
 * Cursor on the strip → Power; cursor in the hex area → Chord; cursor in the
 * neutral gap between them (or no hand → both false) → hold the current mode.
 * The gap gives the boundary natural hysteresis so a cursor hovering the seam
 * doesn't flicker between modes (ADR-0013 left this frontend-side hysteresis to
 * this task). `inStrip` wins if a (degenerate) layout ever overlaps the two.
 */
export function nextPlayMode(
  current: PlayMode,
  inStrip: boolean,
  inHexArea: boolean,
): PlayMode {
  if (inStrip) return "Power";
  if (inHexArea) return "Chord";
  return current;
}

/** Fret positions that get a fretboard inlay dot (single at 3/5/7/9, double 12). */
export const INLAY_FRETS: ReadonlyArray<number> = [3, 5, 7, 9, 12];

/** Everything the thin draw step needs, all plain numbers (no WASM import). */
export interface PowerStripView {
  /** The strip rectangle. */
  readonly rect: Rect;
  /** Centre x of each fret cell (`fretMarkerX(0..maxFret)`), left→right. */
  readonly markerXs: ReadonlyArray<number>;
}

/** Drawing style for the power strip. */
export interface PowerStripStyle {
  readonly fill: string;
  readonly activeFill: string;
  readonly stroke: string;
  readonly activeStroke: string;
  readonly markerColor: string;
  readonly inlayColor: string;
  readonly midlineColor: string;
  readonly labelColor: string;
  readonly hoverFill: string;
  readonly lineWidth: number;
}

export const DEFAULT_POWER_STRIP_STYLE: PowerStripStyle = {
  fill: "rgba(80, 120, 170, 0.08)",
  activeFill: "rgba(232, 161, 58, 0.16)",
  stroke: "rgba(232, 234, 237, 0.28)",
  activeStroke: "#e8a13a",
  markerColor: "rgba(232, 234, 237, 0.45)",
  inlayColor: "rgba(232, 234, 237, 0.6)",
  midlineColor: "rgba(232, 234, 237, 0.18)",
  labelColor: "rgba(232, 234, 237, 0.7)",
  hoverFill: "rgba(232, 161, 58, 0.28)",
  lineWidth: 2,
};

/**
 * Draw the power-chord strip (DOM; not unit-tested — the geometry it relies on
 * is). `active` is whether the app is in Power mode (cursor on the strip): when
 * active the strip gets the accent fill/stroke, and `activeFret` (`-1` = none) /
 * `activePair` (`-1` none, `0` upper, `1` lower) light the hovered fret column
 * in the hovered half, so the mode switch is visibly engaged. `hoverLabel`
 * (e.g. "G5 (fret 3, low E)", task 4.3) replaces the POWER caption while a
 * power chord is hovered, previewing what the next strum will sound.
 */
export function drawPowerStrip(
  ctx: CanvasRenderingContext2D,
  view: PowerStripView,
  active: boolean,
  activeFret = -1,
  activePair = -1,
  hoverLabel: string | null = null,
  style: PowerStripStyle = DEFAULT_POWER_STRIP_STYLE,
): void {
  const { rect, markerXs } = view;
  const w = rect.right - rect.left;
  const h = rect.bottom - rect.top;
  if (!(w > 0) || !(h > 0)) return;
  const mid = (rect.top + rect.bottom) / 2;
  const cellW = markerXs.length > 1 ? markerXs[1]! - markerXs[0]! : w;

  ctx.save();
  ctx.lineJoin = "round";

  // Strip background + border (accented in Power mode).
  ctx.fillStyle = active ? style.activeFill : style.fill;
  ctx.fillRect(rect.left, rect.top, w, h);

  // Hovered fret column, in the hovered string-pair half (Power mode only).
  if (active && activeFret >= 0 && activeFret < markerXs.length) {
    const cx = markerXs[activeFret]!;
    const colLeft = cx - cellW / 2;
    const top = activePair === 1 ? mid : rect.top;
    const bottom = activePair === 0 ? mid : rect.bottom;
    ctx.fillStyle = style.hoverFill;
    ctx.fillRect(colLeft, top, cellW, bottom - top);
  }

  ctx.lineWidth = active ? style.lineWidth + 1 : style.lineWidth;
  ctx.strokeStyle = active ? style.activeStroke : style.stroke;
  ctx.strokeRect(rect.left, rect.top, w, h);

  // String-pair midline (upper = 6th+5th, lower = 5th+4th).
  ctx.strokeStyle = style.midlineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rect.left, mid);
  ctx.lineTo(rect.right, mid);
  ctx.stroke();

  // Fret markers: a tick at each cell boundary plus inlay dots at 3/5/7/9/12.
  ctx.strokeStyle = style.markerColor;
  ctx.lineWidth = 1;
  const dotR = Math.max(2, Math.min(cellW, h) * 0.08);
  for (let f = 0; f < markerXs.length; f++) {
    const cx = markerXs[f]!;
    const edge = cx - cellW / 2;
    ctx.beginPath();
    ctx.moveTo(edge, rect.top);
    ctx.lineTo(edge, rect.bottom);
    ctx.stroke();
    if (INLAY_FRETS.includes(f)) {
      ctx.fillStyle = style.inlayColor;
      if (f === 12) {
        // Double dot at the octave.
        ctx.beginPath();
        ctx.arc(cx, mid - dotR * 1.8, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, mid + dotR * 1.8, dotR, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(cx, mid, dotR, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Pair labels (which string pair each half plays) + a POWER caption.
  const labelSize = Math.max(8, Math.round(h * 0.16));
  ctx.fillStyle = style.labelColor;
  ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("E / A", rect.left + 4, rect.top + h * 0.25);
  ctx.fillText("A / D", rect.left + 4, rect.top + h * 0.75);
  ctx.textAlign = "right";
  ctx.fillStyle = active ? style.activeStroke : style.labelColor;
  ctx.font = `700 ${labelSize}px system-ui, sans-serif`;
  ctx.fillText(active && hoverLabel ? hoverLabel : "POWER", rect.right - 4, rect.top + h * 0.25);

  ctx.restore();
}
