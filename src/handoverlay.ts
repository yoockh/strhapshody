/**
 * Hand-landmark overlay (task 1.1).
 *
 * Splits into a pure, unit-tested coordinate layer and a thin DOM drawing
 * wrapper — the same pattern as `videoframe.ts`:
 *
 *  - `HAND_CONNECTIONS` is the canonical MediaPipe 21-landmark hand skeleton
 *    (which index pairs form a bone), used to draw the connecting lines.
 *  - `landmarkToCanvas` maps a single normalized landmark (coords in [0,1]
 *    relative to the *video frame*) to a canvas pixel position, routing it
 *    through the exact same "cover" crop that `videoframe.drawVideoCover` uses
 *    to blit the frame, plus the same horizontal mirror (PRD §5). That makes
 *    the drawn dots land precisely on top of the hand in the mirrored feed.
 *    This is pure math and is the part worth unit-testing.
 *  - `drawHandLandmarks` is the thin DOM wrapper that actually strokes the
 *    lines and fills the dots; it's exercised by the e2e suite / a human, not
 *    unit tests, because it needs a real 2D context and real landmark data.
 */

import { computeCoverCrop } from "./videoframe.ts";

/** Minimal shape we need off a MediaPipe `NormalizedLandmark` (x,y in [0,1]). */
export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/** A canvas-pixel position. */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Canonical MediaPipe hand-landmark connections: index pairs into the 21-point
 * landmark array that should be joined by a line to draw the hand skeleton.
 * Order groups by digit (thumb, index, middle, ring, pinky) plus the palm
 * arch and the wrist→pinky-base edge. Matches `HandLandmarker.HAND_CONNECTIONS`
 * but is defined locally so this module stays free of the WASM-bound package
 * (and thus unit-testable in a plain node env).
 */
export const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  // Thumb
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // Palm arch (wrist to pinky base)
  [0, 17],
];

/** Number of landmarks MediaPipe reports per hand. */
export const LANDMARKS_PER_HAND = 21;

/**
 * Map a normalized landmark (x,y in [0,1] relative to the source video frame)
 * to a canvas pixel position that lines up with the drawn, cover-fit,
 * optionally-mirrored video.
 *
 * `mirror` must match whether the feed was drawn flipped (it is, per PRD §5):
 * when true the x axis is reflected about the canvas centre so the overlay
 * tracks the mirrored image rather than the raw camera image.
 *
 * Degenerate inputs (non-positive dimensions, or a crop that collapses to zero
 * width/height) return the canvas origin rather than NaN/Infinity, so an early
 * render frame can't produce garbage coordinates.
 */
export function landmarkToCanvas(
  landmark: Point2D,
  videoW: number,
  videoH: number,
  dstW: number,
  dstH: number,
  mirror: boolean,
): CanvasPoint {
  if (videoW <= 0 || videoH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0 };
  }

  const { sx, sy, sw, sh } = computeCoverCrop(videoW, videoH, dstW, dstH);
  if (sw <= 0 || sh <= 0) {
    return { x: 0, y: 0 };
  }

  // Landmark in source-frame pixels, then into the visible crop, then scaled
  // to the destination canvas.
  const px = landmark.x * videoW;
  const py = landmark.y * videoH;
  let x = ((px - sx) / sw) * dstW;
  const y = ((py - sy) / sh) * dstH;

  if (mirror) {
    x = dstW - x;
  }

  return { x, y };
}

/** Drawing style for the overlay. */
export interface HandOverlayStyle {
  readonly connectionColor: string;
  readonly pointColor: string;
  readonly lineWidth: number;
  readonly pointRadius: number;
}

export const DEFAULT_HAND_OVERLAY_STYLE: HandOverlayStyle = {
  connectionColor: "rgba(232, 234, 237, 0.85)",
  pointColor: "#e8a13a",
  lineWidth: 2,
  pointRadius: 4,
};

/**
 * Draw the skeleton + joints for each detected hand onto the canvas (DOM; not
 * unit-tested). `hands` is MediaPipe's `landmarks` array: one entry per hand,
 * each a list of 21 normalized landmarks. Hands with the wrong landmark count
 * are skipped defensively.
 */
export function drawHandLandmarks(
  ctx: CanvasRenderingContext2D,
  hands: ReadonlyArray<ReadonlyArray<Point2D>>,
  videoW: number,
  videoH: number,
  dstW: number,
  dstH: number,
  mirror: boolean,
  style: HandOverlayStyle = DEFAULT_HAND_OVERLAY_STYLE,
): void {
  for (const hand of hands) {
    if (hand.length < LANDMARKS_PER_HAND) {
      continue;
    }

    const pts = hand.map((lm) =>
      landmarkToCanvas(lm, videoW, videoH, dstW, dstH, mirror),
    );

    // Bones first, so the joint dots sit on top.
    ctx.strokeStyle = style.connectionColor;
    ctx.lineWidth = style.lineWidth;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (const [a, b] of HAND_CONNECTIONS) {
      const pa = pts[a];
      const pb = pts[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.stroke();

    // Joints.
    ctx.fillStyle = style.pointColor;
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, style.pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
