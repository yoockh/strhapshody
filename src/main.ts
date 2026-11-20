import "./style.css";
import { createStage } from "./stage.ts";
import { drawFeedPattern, drawZoneOverlay } from "./placeholder.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) {
  throw new Error("#stage canvas not found");
}

const stage = createStage(canvas);

function render(): void {
  const { ctx, width, height } = stage;
  ctx.clearRect(0, 0, width, height);

  // Feed layer (mirrored, as the real webcam frames will be from task 0.4).
  stage.withMirroredFeed((c) => drawFeedPattern(c, width, height));

  // Overlay (un-mirrored) so labels stay readable.
  drawZoneOverlay(ctx, width, height);

  requestAnimationFrame(render);
}

requestAnimationFrame(render);
