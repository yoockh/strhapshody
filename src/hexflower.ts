/**
 * Hex chord-flower UI (task 3.2 / PRD §6.1).
 *
 * The *selection* logic (which of the 7 cells a cursor is in, plus border
 * hysteresis) lives in the Rust/WASM `hexmap` module (task 3.1, ADR-0010); this
 * module only *draws* the flower and tracks the cursor. Following the ADR-0002
 * split it is two layers:
 *
 *  - PURE, unit-tested geometry: `flatTopHexVertices` (the 6 corners of one
 *    flat-top hexagon) and `computeHexFlowerLayout` (where to put the flower and
 *    how big to make it so all 7 cells fit inside the left zone). These are the
 *    parts worth testing — they must match the engine's flat-top layout exactly.
 *  - A thin DOM `drawHexFlower` wrapper that strokes/fills the cells, labels each
 *    with its chord letter, highlights the active cell, and dots the cursor. It
 *    needs a real 2D context, so it's exercised by the e2e suite / a human, not
 *    unit tests.
 *
 * The engine owns the cell *centres* (`HexMap.centerX/centerY`) and `radius`;
 * the frontend passes those through here as plain numbers so this module never
 * touches the WASM package (keeps it node-testable).
 */

import type { CanvasPoint } from "./handoverlay.ts";

const SQRT_3 = Math.sqrt(3);

/**
 * The flower's bounding box, in units of the hex circumradius `R`:
 *  - width  = 5·R   (ring cell centres span ±3R/2, each hex reaches ±R in x)
 *  - height = 3√3·R (ring cell centres span ±√3R, each hex reaches ±√3/2·R in y)
 * These must track the engine's flat-top layout (hexmap.rs) so the drawn cells
 * line up with the containment test.
 */
export const FLOWER_WIDTH_IN_R = 5;
export const FLOWER_HEIGHT_IN_R = 3 * SQRT_3;

/** Flower placement + size, in canvas pixels. */
export interface HexFlowerLayout {
  /** Flower centre x (centre cell C sits here). */
  readonly cx: number;
  /** Flower centre y. */
  readonly cy: number;
  /** Hex circumradius (centre → vertex). */
  readonly radius: number;
}

/** One cell to draw: centre in canvas px plus its chord letter. */
export interface HexCell {
  readonly x: number;
  readonly y: number;
  readonly chord: string;
}

/** Clamp `x` to [lo, hi]; non-finite → lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

/**
 * The 6 vertices of a **flat-top** regular hexagon of circumradius `r` centred
 * at `(cx, cy)`, in canvas coordinates (y increases downward). Returned starting
 * at the rightmost vertex and going clockwise on screen. "Flat-top" means a
 * horizontal edge sits at the top and bottom (the top edge runs at
 * `cy - √3/2·r`), matching the engine's containment test in `hexmap.rs`.
 *
 * A non-finite or non-positive `r` yields 6 coincident points at the centre
 * (degenerate, but never NaN) so an early/garbage frame can't throw while drawing.
 */
export function flatTopHexVertices(
  cx: number,
  cy: number,
  r: number,
): CanvasPoint[] {
  const rr = Number.isFinite(r) && r > 0 ? r : 0;
  const pts: CanvasPoint[] = [];
  for (let k = 0; k < 6; k++) {
    const angle = (Math.PI / 3) * k; // 0°, 60°, … 300°
    pts.push({ x: cx + rr * Math.cos(angle), y: cy + rr * Math.sin(angle) });
  }
  return pts;
}

/**
 * Compute where to place the hex flower and how large to make it so all 7 cells
 * fit inside the rectangle `[left, top]`–`[right, bottom]` (the left zone, below
 * the status bar). The flower is centred in the rectangle; its radius is the
 * largest that keeps the full `5R × 3√3R` bounding box inside the rectangle after
 * reserving a `padding` fraction of margin on every side.
 *
 * `padding` is clamped to [0, 0.49]. A degenerate rectangle (zero/negative size)
 * yields a floored radius of 1 (never 0/NaN), so callers can still build a valid
 * `HexMap` and draw nothing meaningful rather than crash.
 */
export function computeHexFlowerLayout(
  left: number,
  top: number,
  right: number,
  bottom: number,
  padding = 0.08,
): HexFlowerLayout {
  const w = Math.max(0, right - left);
  const h = Math.max(0, bottom - top);
  const pad = clamp(padding, 0, 0.49);
  const availW = w * (1 - 2 * pad);
  const availH = h * (1 - 2 * pad);
  const radius = Math.max(
    1,
    Math.min(availW / FLOWER_WIDTH_IN_R, availH / FLOWER_HEIGHT_IN_R),
  );
  return { cx: (left + right) / 2, cy: (top + bottom) / 2, radius };
}

/** Drawing style for the flower. */
export interface HexFlowerStyle {
  readonly cellFill: string;
  readonly cellStroke: string;
  readonly activeFill: string;
  readonly activeStroke: string;
  readonly labelColor: string;
  readonly activeLabelColor: string;
  readonly cursorColor: string;
  readonly lineWidth: number;
}

export const DEFAULT_HEX_FLOWER_STYLE: HexFlowerStyle = {
  cellFill: "rgba(80, 120, 170, 0.10)",
  cellStroke: "rgba(232, 234, 237, 0.35)",
  activeFill: "rgba(232, 161, 58, 0.22)",
  activeStroke: "#e8a13a",
  labelColor: "rgba(232, 234, 237, 0.7)",
  activeLabelColor: "#f6d08a",
  cursorColor: "#e8a13a",
  lineWidth: 2,
};

/**
 * Draw the 7-cell chord flower and (optionally) the palm cursor (DOM; not
 * unit-tested — the geometry it relies on is). `activeIndex` is the currently
 * hovered cell (`-1` = none) and gets the accent fill/stroke + a bolder label.
 */
export function drawHexFlower(
  ctx: CanvasRenderingContext2D,
  cells: ReadonlyArray<HexCell>,
  radius: number,
  activeIndex: number,
  cursor: CanvasPoint | null = null,
  style: HexFlowerStyle = DEFAULT_HEX_FLOWER_STYLE,
): void {
  ctx.save();
  ctx.lineJoin = "round";
  const labelSize = Math.max(10, Math.round(radius * 0.5));

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const active = i === activeIndex;
    const verts = flatTopHexVertices(cell.x, cell.y, radius);

    ctx.beginPath();
    ctx.moveTo(verts[0]!.x, verts[0]!.y);
    for (let v = 1; v < verts.length; v++) ctx.lineTo(verts[v]!.x, verts[v]!.y);
    ctx.closePath();

    ctx.fillStyle = active ? style.activeFill : style.cellFill;
    ctx.fill();
    ctx.lineWidth = active ? style.lineWidth + 1 : style.lineWidth;
    ctx.strokeStyle = active ? style.activeStroke : style.cellStroke;
    ctx.stroke();

    ctx.fillStyle = active ? style.activeLabelColor : style.labelColor;
    ctx.font = `600 ${labelSize}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(cell.chord, cell.x, cell.y);
  }

  if (cursor) {
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, Math.max(4, radius * 0.12), 0, Math.PI * 2);
    ctx.fillStyle = style.cursorColor;
    ctx.fill();
  }

  ctx.restore();
}
