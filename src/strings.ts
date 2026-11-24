/**
 * Virtual guitar strings (task 2.1 / PRD §8): six horizontal lines drawn across
 * the right (strum) zone. The right hand crosses them to strum. This task only
 * *renders* the lines; crossing/direction/velocity detection is the Rust
 * `strum` engine module in task 2.2.
 *
 * Split per ADR-0002: the pure geometry (`computeStringYs`, `stringWidth`) is
 * unit-tested with synthetic bounds; `drawStrings` is a thin DOM wrapper
 * exercised by the e2e suite / a human (it needs a real 2D context).
 */

/** A standard guitar has six strings. */
export const STRING_COUNT = 6;

/**
 * Standard-tuning note names, index 0 → 5 == top → bottom of the zone. The low
 * E (6th string, thickest) is at the top so a downstroke — which sounds "top to
 * bottom" (PRD §8) — starts on the lowest-pitched string, matching a real
 * guitar downstroke. The high E (1st string) is the lowercase "e" at the
 * bottom, the usual tab convention for telling the two E strings apart.
 */
export const STRING_NOTE_NAMES: readonly string[] = ["E", "A", "D", "G", "B", "e"];

/** Clamp to [0, 1]; non-finite → 0. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Evenly-spaced y positions (CSS px) for `count` string lines inside the
 * vertical band [top, bottom], inset by `marginFraction` of the band height at
 * each end so the outer strings don't hug the zone edges. Returned top-to-bottom
 * (ascending y).
 *
 * `marginFraction` is clamped to [0, 0.5): it can inset at most just under half
 * the band from each side, so the usable inner band never collapses or inverts.
 * A degenerate band (bottom <= top) yields all-equal y values, never NaN.
 */
export function computeStringYs(
  top: number,
  bottom: number,
  count: number = STRING_COUNT,
  marginFraction = 0.12,
): number[] {
  const n = Math.max(1, Math.floor(count));
  const height = Math.max(0, bottom - top);
  // Keep a sliver of inner band even at extreme fractions (strictly < 0.5).
  const frac = Math.min(0.49, clamp01(marginFraction));
  const margin = height * frac;
  const innerTop = top + margin;
  const innerBottom = bottom - margin;

  if (n === 1) return [(innerTop + innerBottom) / 2];

  const step = (innerBottom - innerTop) / (n - 1);
  const ys: number[] = [];
  for (let i = 0; i < n; i++) ys.push(innerTop + step * i);
  return ys;
}

/**
 * Visual stroke width (CSS px) for string `index`, tapering from `maxWidth` at
 * the top (index 0, low E — thickest gauge) to `minWidth` at the bottom (the
 * high E), so the lines read like real strings of decreasing gauge.
 */
export function stringWidth(
  index: number,
  count: number = STRING_COUNT,
  maxWidth = 3.25,
  minWidth = 1,
): number {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return maxWidth;
  const t = clamp01(index / (n - 1)); // 0 at top → 1 at bottom
  return maxWidth + (minWidth - maxWidth) * t;
}

const STRING_INK = "rgba(232, 234, 237, 0.55)";

/**
 * Draw the six virtual strings across the right (strum) zone. `zoneLeft` is the
 * zone's left edge (the screen midline), `zoneRight` its right edge; the band
 * runs vertically from `top` (below the status bar) to `bottom`. A small
 * horizontal inset keeps the line ends off the zone borders. (DOM; not
 * unit-tested — the geometry it relies on is.)
 */
export function drawStrings(
  ctx: CanvasRenderingContext2D,
  zoneLeft: number,
  zoneRight: number,
  top: number,
  bottom: number,
  glow: readonly number[] = [],
): void {
  const ys = computeStringYs(top, bottom);
  const inset = (zoneRight - zoneLeft) * 0.04;
  const x0 = zoneLeft + inset;
  const x1 = zoneRight - inset;

  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < ys.length; i++) {
    const g = Math.min(1, Math.max(0, glow[i] ?? 0));
    ctx.strokeStyle = g > 0 ? `rgba(232, 161, 58, ${0.45 + 0.55 * g})` : STRING_INK;
    ctx.lineWidth = stringWidth(i) * (1 + 1.5 * g);
    ctx.beginPath();
    ctx.moveTo(x0, ys[i]!);
    ctx.lineTo(x1, ys[i]!);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Per-string glow in [0,1] for the "just plucked" highlight: 1 at the pluck,
 * fading linearly to 0 over `fade` seconds. `lastPluck[i]` is string i's last
 * pluck time (seconds, same clock as `now`), or -Infinity if never. A pluck
 * scheduled slightly in the future (keyboard rake) reads as 1.
 */
export function stringGlow(
  lastPluck: readonly number[],
  now: number,
  fade = 0.25,
): number[] {
  return lastPluck.map((t) => {
    if (!Number.isFinite(t) || !(fade > 0)) return 0;
    const age = now - t;
    return age <= 0 ? 1 : Math.max(0, 1 - age / fade);
  });
}
