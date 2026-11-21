import "./style.css";
import { createStage } from "./stage.ts";
import { drawFeedPattern, drawZoneOverlay, drawErrorBanner } from "./placeholder.ts";
import { startWebcam, describeCameraError, type WebcamHandle } from "./webcam.ts";
import { drawVideoCover } from "./videoframe.ts";
import { createHandTracker, type HandTracker } from "./handtracking.ts";
import { drawHandLandmarks, landmarkToCanvas } from "./handoverlay.ts";
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
  statusBarHeight,
  trackingSummary,
  type StatusBarModel,
} from "./hud.ts";
import { drawStrings, computeStringYs } from "./strings.ts";
import { initEngine, StrumDetector, type StrumDetectorInstance } from "./engine.ts";
import { createAudioEngine, type AudioEngine } from "./audio.ts";
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

// Audio + strum state (task 2.4). The WASM `strum` detector turns the right
// hand's trajectory into string-crossing events; the Web Audio engine plays a
// plucked voice per crossing. The AudioContext starts suspended and is resumed
// on the first user gesture (browser autoplay policy).
let audioEngine: AudioEngine | null = null;
let engineReady = false;
let strumDetector: StrumDetectorInstance | null = null;
// String-line y signature the current detector was built for; rebuilt on resize.
let strumGeometry = "";

try {
  audioEngine = createAudioEngine();
} catch (err) {
  console.warn("[strhapshody] audio unavailable:", err);
}

// Resume audio on the first user interaction (pointer or key), once.
function resumeAudioOnce(): void {
  audioEngine?.resume().catch(() => {});
  window.removeEventListener("pointerdown", resumeAudioOnce);
  window.removeEventListener("keydown", resumeAudioOnce);
}
window.addEventListener("pointerdown", resumeAudioOnce);
window.addEventListener("keydown", resumeAudioOnce);

// Initialize the WASM engine in the background; the strum detector is created
// lazily once it's ready and the strum-zone geometry is known.
initEngine()
  .then(() => {
    engineReady = true;
  })
  .catch((err: unknown) => {
    console.warn("[strhapshody] engine init failed:", err);
  });

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

  // Six virtual strings across the right (strum) zone, below the status bar
  // (PRD §8 / task 2.1). Strum detection against these lines comes in task 2.2.
  const barH = statusBarHeight(height);
  drawStrings(ctx, width / 2, width, barH, height);

  // Strum detection → audio (task 2.4): feed the right hand's palm y to the
  // WASM strum detector and pluck a string voice for every crossing it reports.
  processStrum(assignments, barH, width, height);

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
 * Drive the strum detector from the right hand and trigger audio (task 2.4).
 *
 * Rebuilds the detector when the strum-zone geometry changes (resize), feeds it
 * the strum hand's palm-centre y mapped into canvas pixels (the same mapping the
 * overlay uses, so it lines up with the drawn strings), and plucks a voice for
 * each crossing. When there's no tracked strum hand it resets the detector so a
 * hand re-entering the frame doesn't register as one giant whole-zone strum
 * (ADR-0007).
 */
function processStrum(
  assignments: AssignedHand[],
  barH: number,
  width: number,
  height: number,
): void {
  if (!engineReady) return;

  // (Re)build the detector when the six string-line y positions change.
  const stringYs = computeStringYs(barH, height);
  const sig = stringYs.map((y) => Math.round(y)).join(",");
  if (!strumDetector || sig !== strumGeometry) {
    strumDetector?.free();
    strumDetector = new StrumDetector(new Float64Array(stringYs));
    strumGeometry = sig;
  }

  const strumHand = assignments.find((a) => a.role === "strum");
  const lm =
    strumHand && latestHands ? latestHands.landmarks[strumHand.index] : undefined;

  if (!webcam || !strumHand || !lm || !lm[0] || !lm[9]) {
    // No tracked strum hand this frame — re-seed so the next push doesn't jump.
    strumDetector.reset();
    return;
  }

  // Palm centre (wrist + middle-MCP mean), mapped through the same cover-crop +
  // mirror transform as the feed/overlay so the y lines up with the strings.
  const palm = {
    x: (lm[0].x + lm[9].x) / 2,
    y: (lm[0].y + lm[9].y) / 2,
  };
  const { videoWidth, videoHeight } = webcam.video;
  const point = landmarkToCanvas(palm, videoWidth, videoHeight, width, height, true);

  const events = strumDetector.push(point.y, performance.now() / 1000);
  for (const ev of events) {
    const index = ev.string_index;
    const velocity = ev.velocity;
    ev.free();
    audioEngine?.pluck(index, velocity);
  }
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
  audioEngine?.close();
  strumDetector?.free();
});
