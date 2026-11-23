/**
 * Heads-up display (task 1.2): the left/right zone split and the status-bar
 * skeleton from PRD §5 ("A small status bar shows the current chord, mode
 * (Chord / Power), instrument, and tracking health").
 *
 * Split, like placeholder.ts / handoverlay.ts, into:
 *  - `trackingSummary` — a PURE helper (unit-tested) turning the hand
 *    assignments into a one-line tracking-health label plus per-role flags.
 *  - `drawZoneSplit` / `drawStatusBar` — thin DOM drawing wrappers, exercised
 *    by the e2e suite / a human, not unit-tested (they need a real 2D context).
 *
 * The real values (chord name, mode, instrument) are placeholders here; later
 * phases (3 chord selection, 4 power mode, 5 instruments) fill them in.
 */

import type { AssignedHand, HandRole } from "./handedness.ts";
import { roleIsTracked } from "./handedness.ts";

/** Status-bar fields (PRD §5). All placeholders until later phases wire them. */
export interface StatusBarModel {
  readonly chord: string;
  /** Play mode plus any right-hand modifier, e.g. "Power · palm mute". */
  readonly mode: string;
  readonly instrument: string;
  readonly tracking: string;
}

export interface TrackingSummary {
  readonly chord: boolean;
  readonly strum: boolean;
  readonly label: string;
}

/**
 * Summarize hand-tracking health from the role assignments: which roles are
 * covered and a short human label for the status bar. Pure + unit-tested.
 */
export function trackingSummary(
  assignments: ReadonlyArray<AssignedHand>,
): TrackingSummary {
  const chord = roleIsTracked(assignments, "chord");
  const strum = roleIsTracked(assignments, "strum");
  let label: string;
  if (chord && strum) label = "OK · both hands";
  else if (chord) label = "left hand only";
  else if (strum) label = "right hand only";
  else label = "no hands";
  return { chord, strum, label };
}

const INK = "rgba(232, 234, 237, 0.9)";
const INK_DIM = "rgba(232, 234, 237, 0.5)";
const ACCENT = "#e8a13a";

/**
 * Height (CSS px) the status bar occupies for a given viewport height. Exported
 * so overlays that must sit *below* the bar (zone split, virtual strings) can
 * share the one definition rather than re-deriving the formula.
 */
export function statusBarHeight(height: number): number {
  return Math.max(36, Math.round(height * 0.07));
}

/**
 * Draw the two zones as faint tinted halves with an active-zone highlight.
 * `activeRoles` controls which half glows (a hand is currently assigned to it);
 * the dashed divider and the LEFT/RIGHT labels stay in placeholder.drawZoneOverlay
 * so this layer is purely the tint + highlight. (DOM; not unit-tested.)
 */
export function drawZoneSplit(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  activeRoles: ReadonlySet<HandRole>,
  statusBarHeight = 0,
): void {
  const midX = width / 2;
  const top = statusBarHeight;
  const h = height - statusBarHeight;

  // Base tints: a cool wash on the chord (left) half, a warm wash on the strum
  // (right) half, so the two zones read as distinct regions.
  ctx.fillStyle = "rgba(80, 120, 170, 0.08)";
  ctx.fillRect(0, top, midX, h);
  ctx.fillStyle = "rgba(170, 120, 70, 0.08)";
  ctx.fillRect(midX, top, width - midX, h);

  // Active-zone highlight: a thin accent border inset into whichever half has a
  // tracked hand right now.
  ctx.lineWidth = 3;
  ctx.strokeStyle = ACCENT;
  if (activeRoles.has("chord")) {
    ctx.strokeRect(3, top + 3, midX - 6, h - 6);
  }
  if (activeRoles.has("strum")) {
    ctx.strokeRect(midX + 3, top + 3, width - midX - 6, h - 6);
  }
}

/**
 * Draw the top status bar with four fields: chord, mode, instrument, tracking
 * health. Returns the bar's height in CSS pixels so callers can offset other
 * overlays below it. (DOM; not unit-tested.)
 */
export function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  model: StatusBarModel,
): number {
  const barH = statusBarHeight(height);
  const fontSize = Math.round(barH * 0.3);
  const labelSize = Math.round(barH * 0.2);

  // Bar background.
  ctx.fillStyle = "rgba(14, 18, 24, 0.82)";
  ctx.fillRect(0, 0, width, barH);
  ctx.strokeStyle = "rgba(232, 234, 237, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH + 0.5);
  ctx.lineTo(width, barH + 0.5);
  ctx.stroke();

  const fields: ReadonlyArray<readonly [string, string]> = [
    ["CHORD", model.chord],
    ["MODE", model.mode],
    ["INSTRUMENT", model.instrument],
    ["TRACKING", model.tracking],
  ];

  const cellW = width / fields.length;
  ctx.textBaseline = "middle";
  const labelY = barH * 0.33;
  const valueY = barH * 0.68;

  for (let i = 0; i < fields.length; i++) {
    const [label, value] = fields[i]!;
    const cx = cellW * i + cellW / 2;

    // Field separators.
    if (i > 0) {
      ctx.strokeStyle = "rgba(232, 234, 237, 0.12)";
      ctx.beginPath();
      ctx.moveTo(cellW * i, barH * 0.2);
      ctx.lineTo(cellW * i, barH * 0.8);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = INK_DIM;
    ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
    ctx.fillText(label, cx, labelY);

    ctx.fillStyle = INK;
    ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
    ctx.fillText(value, cx, valueY);
  }

  return barH;
}
