/**
 * Video-frame fitting (task 0.4).
 *
 * The webcam's native aspect ratio rarely matches the full-viewport canvas, so
 * we draw it "cover"-style: scale the frame up until it fills the canvas in
 * both axes and crop the overflow, keeping the image centred and undistorted
 * (never letterboxed, never stretched). `computeCoverCrop` is the pure math of
 * that fit — which sub-rectangle of the source frame maps onto the whole
 * canvas — and is unit-tested. `drawVideoCover` is the thin DOM wrapper that
 * actually blits, exercised by the e2e suite.
 */

export interface CoverCrop {
  /** Source-frame crop rectangle (in source pixels). */
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/**
 * Given a source frame (srcW × srcH) and a destination area (dstW × dstH),
 * return the centred source sub-rectangle that, drawn onto the entire
 * destination, produces an aspect-correct "cover" fit.
 *
 * Degenerate inputs (any dimension ≤ 0) return a safe zero-ish crop rather
 * than NaN/Infinity, so a render frame before the video has real dimensions
 * can't throw.
 */
export function computeCoverCrop(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): CoverCrop {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(0, srcW), sh: Math.max(0, srcH) };
  }

  // Scale needed to cover both axes; the larger ratio wins.
  const scale = Math.max(dstW / srcW, dstH / srcH);

  // Visible slice of the source, in source pixels.
  const sw = dstW / scale;
  const sh = dstH / scale;
  const sx = (srcW - sw) / 2;
  const sy = (srcH - sh) / 2;

  return { sx, sy, sw, sh };
}

/**
 * Draw `video`'s current frame onto the full destination area, cover-fit.
 * No-op if the video has no frame data yet. (DOM; not unit-tested.)
 */
export function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  dstW: number,
  dstH: number,
): void {
  const { videoWidth, videoHeight } = video;
  if (videoWidth <= 0 || videoHeight <= 0) {
    return;
  }
  const { sx, sy, sw, sh } = computeCoverCrop(videoWidth, videoHeight, dstW, dstH);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dstW, dstH);
}
