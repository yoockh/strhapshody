import "./style.css";
import { createStage } from "./stage.ts";
import { drawFeedPattern, drawZoneOverlay, drawErrorBanner } from "./placeholder.ts";
import { startWebcam, describeCameraError, type WebcamHandle } from "./webcam.ts";
import { drawVideoCover } from "./videoframe.ts";
import { createHandTracker, type HandTracker } from "./handtracking.ts";
import { drawHandLandmarks } from "./handoverlay.ts";
import {
  assignHands,
  type AssignedHand,
  type Handedness,
  type HandRole,
  type RawHand,
} from "./handedness.ts";
import {
  drawZoneSplit,
  drawStatusBar,
  trackingSummary,
  type StatusBarModel,
} from "./hud.ts";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";

/** Adapt a MediaPipe result into the pure `RawHand[]` the assigner consumes. */
function toRawHands(result: HandLandmarkerResult): RawHand[] {
  const hands: RawHand[] = [];
  for (let i = 0; i < result.landmarks.length; i++) {
    const landmarks = result.landmarks[i];
    if (!landmarks) continue;
    const category = result.handedness[i]?.[0];
    const handedness: Handedness =
      category?.categoryName === "Left" ? "Left" : "Right";
    hands.push({ handedness, score: category?.score ?? 0, landmarks });
  }
  return hands;
}

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
// Hand tracking state (task 1.1). The tracker is created only after the camera
// is live; detection failures must never break the render loop.
let handTracker: HandTracker | null = null;
let latestHands: HandLandmarkerResult | null = null;

startWebcam()
  .then((handle) => {
    webcam = handle;
    // Load MediaPipe in the background. If its WASM/model can't load (e.g.
    // offline), we keep showing the feed without an overlay rather than failing.
    createHandTracker()
      .then((tracker) => {
        handTracker = tracker;
      })
      .catch((err: unknown) => {
        console.warn("[strhapshody] hand tracking unavailable:", err);
      });
  })
  .catch((err: unknown) => {
    cameraError = describeCameraError(err);
    console.warn("[strhapshody] camera unavailable:", err);
  });

function render(): void {
  const { ctx, width, height } = stage;
  ctx.clearRect(0, 0, width, height);

  // Per-frame hand assignment (task 1.2): which hand drives chords vs strum.
  let assignments: AssignedHand[] = [];

  // Feed layer (mirrored, PRD §5): the live webcam frame once available,
  // otherwise the static placeholder pattern.
  if (webcam) {
    stage.withMirroredFeed((c) => drawVideoCover(c, webcam!.video, width, height));

    // Run hand detection on this frame. Detection failures must never break
    // the render loop (they're caught and logged).
    if (handTracker) {
      try {
        const result = handTracker.detect(webcam.video, performance.now());
        if (result) {
          latestHands = result;
        }
      } catch (err) {
        console.warn("[strhapshody] hand detection error:", err);
      }
      if (latestHands && latestHands.landmarks.length > 0) {
        assignments = assignHands(toRawHands(latestHands));
      }
    }
  } else {
    stage.withMirroredFeed((c) => drawFeedPattern(c, width, height));
  }

  // Un-mirrored overlay. Zone tint + active-zone highlight first (behind the
  // divider, labels, and skeleton), driven by the live assignments.
  const activeRoles = new Set<HandRole>(assignments.map((a) => a.role));
  drawZoneSplit(ctx, width, height, activeRoles);

  // Centre divider, zone labels, and (while starting) a status caption.
  const caption = webcam || cameraError ? undefined : "starting camera…";
  drawZoneOverlay(ctx, width, height, caption);

  // Hand skeleton on top of the tints (mirror baked into the coordinates).
  if (webcam && latestHands && latestHands.landmarks.length > 0) {
    const { videoWidth, videoHeight } = webcam.video;
    drawHandLandmarks(
      ctx,
      latestHands.landmarks,
      videoWidth,
      videoHeight,
      width,
      height,
      true,
    );
  }

  // Status bar skeleton (PRD §5). Values are placeholders until later phases.
  drawStatusBar(ctx, width, height, buildStatusModel(assignments));

  // Graceful error path: permission denied, no device, camera in use, etc.
  if (cameraError) {
    drawErrorBanner(ctx, width, height, "Camera unavailable", cameraError);
  }

  requestAnimationFrame(render);
}

/**
 * Build the status-bar model for this frame. Chord/instrument are placeholders
 * (Phases 3/5); tracking health reflects the real pipeline state so the
 * skeleton is informative rather than static.
 */
function buildStatusModel(assignments: AssignedHand[]): StatusBarModel {
  let tracking: string;
  if (cameraError) tracking = "camera off";
  else if (!webcam) tracking = "starting camera…";
  else if (!handTracker) tracking = "loading tracker…";
  else tracking = trackingSummary(assignments).label;

  return {
    chord: "—",
    mode: "Chord",
    instrument: "Acoustic",
    tracking,
  };
}

requestAnimationFrame(render);

// Release the camera when the page goes away.
window.addEventListener("beforeunload", () => {
  webcam?.stop();
  handTracker?.close();
});
