import "./style.css";
import { createStage } from "./stage.ts";
import { drawFeedPattern, drawZoneOverlay, drawErrorBanner } from "./placeholder.ts";
import { startWebcam, describeCameraError, type WebcamHandle } from "./webcam.ts";
import { drawVideoCover } from "./videoframe.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#stage");
if (!canvas) {
  throw new Error("#stage canvas not found");
}

const stage = createStage(canvas);

// Camera state. Three render states: starting (no handle, no error), live
// (handle set), failed (error set). The render loop below reads these.
let webcam: WebcamHandle | null = null;
let cameraError: string | null = null;

// Kick off camera capture (task 0.4). The placeholder feed shows until this
// resolves; on failure we fall back to the placeholder plus an error banner.
startWebcam()
  .then((handle) => {
    webcam = handle;
  })
  .catch((err: unknown) => {
    cameraError = describeCameraError(err);
    console.warn("[strhapshody] camera unavailable:", err);
  });

function render(): void {
  const { ctx, width, height } = stage;
  ctx.clearRect(0, 0, width, height);

  // Feed layer (mirrored, PRD §5): the live webcam frame once available,
  // otherwise the static placeholder pattern.
  if (webcam) {
    stage.withMirroredFeed((c) => drawVideoCover(c, webcam!.video, width, height));
  } else {
    stage.withMirroredFeed((c) => drawFeedPattern(c, width, height));
  }

  // Overlay (un-mirrored) so labels stay readable. Caption only while there's
  // no live feed and no hard error.
  const caption = webcam || cameraError ? undefined : "starting camera…";
  drawZoneOverlay(ctx, width, height, caption);

  // Graceful error path: permission denied, no device, camera in use, etc.
  if (cameraError) {
    drawErrorBanner(ctx, width, height, "Camera unavailable", cameraError);
  }

  requestAnimationFrame(render);
}

requestAnimationFrame(render);

// Release the camera when the page goes away.
window.addEventListener("beforeunload", () => {
  webcam?.stop();
});
