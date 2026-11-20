/**
 * Stage: owns the <canvas>, keeps its backing store sized to the viewport
 * (device-pixel-ratio aware) and exposes a 2D context plus logical
 * (CSS-pixel) dimensions for drawing.
 *
 * Mirroring note (PRD §5): the webcam feed must be mirrored so the player's
 * left hand appears on the left of the screen. We do that mirroring inside
 * the 2D context (a horizontal flip) only while drawing the "feed" layer, so
 * that overlay text drawn afterwards is not mirrored. `withMirroredFeed`
 * encapsulates that flip. Until task 0.4 wires up getUserMedia, the feed
 * layer is a static placeholder test pattern.
 */

export interface Stage {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  /** Logical width in CSS pixels (not backing-store pixels). */
  readonly width: number;
  /** Logical height in CSS pixels (not backing-store pixels). */
  readonly height: number;
  /**
   * Run `draw` with the context horizontally mirrored, so content drawn in
   * logical coordinates [0..width] appears flipped left-to-right. The
   * transform is saved/restored around the callback.
   */
  withMirroredFeed(draw: (ctx: CanvasRenderingContext2D) => void): void;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  const stage: Stage = {
    canvas,
    ctx,
    width: 0,
    height: 0,
    withMirroredFeed(draw) {
      ctx.save();
      // Flip horizontally around the vertical centre line of the logical
      // drawing area: translate to the right edge, then scale x by -1.
      ctx.translate(stage.width, 0);
      ctx.scale(-1, 1);
      draw(ctx);
      ctx.restore();
    },
  };

  const resize = () => {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth || window.innerWidth;
    const cssHeight = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    // Draw in CSS-pixel coordinates regardless of DPR.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    (stage as { width: number }).width = cssWidth;
    (stage as { height: number }).height = cssHeight;
  };

  resize();
  window.addEventListener("resize", resize);

  return stage;
}
