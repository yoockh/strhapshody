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
import {
  initEngine,
  StrumDetector,
  HexMap,
  OneEuroFilter,
  FingerCountDetector,
  ChordLatch,
  type StrumDetectorInstance,
  type HexMapInstance,
  type OneEuroFilterInstance,
  type FingerCountDetectorInstance,
  type ChordLatchInstance,
} from "./engine.ts";
import {
  computeHexFlowerLayout,
  drawHexFlower,
  type HexCell,
} from "./hexflower.ts";
import { chordLabel } from "./chord.ts";
import { chordFrequencies } from "./chords.ts";
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

/**
 * Flatten a hand's 21 MediaPipe landmarks into the interleaved `[x0,y0,…x20,y20]`
 * `Float64Array` the engine's landmark consumers expect (ADR-0008). Only the
 * normalized image-plane x,y are used; the finger-count metric is scale/rotation/
 * translation invariant so the raw normalized coords are fed directly (no canvas
 * mapping needed).
 */
function flattenLandmarks(lm: ReadonlyArray<{ x: number; y: number }>): Float64Array {
  const flat = new Float64Array(lm.length * 2);
  for (let i = 0; i < lm.length; i++) {
    flat[i * 2] = lm[i]!.x;
    flat[i * 2 + 1] = lm[i]!.y;
  }
  return flat;
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

// Chord-flower state (task 3.2). The WASM `hexmap` selector (ADR-0010) decides
// which of the 7 cells the left hand's palm cursor is in, with border
// hysteresis; the cursor is One-Euro-smoothed (ADR-0006) so it doesn't jitter
// between chords. The hex layout is rebuilt when the left-zone geometry changes.
let hexMap: HexMapInstance | null = null;
let hexGeometry = "";
let cursorFilterX: OneEuroFilterInstance | null = null;
let cursorFilterY: OneEuroFilterInstance | null = null;
// Hysteresis dead-band as a fraction of the hex radius (feel-tunable, Phase 6.2;
// clamped to [0,0.49R] inside the engine). One Euro params for the palm cursor:
// gentle baseline smoothing (min cutoff) that opens up with speed (beta), in the
// seconds-timestamp convention of ADR-0006.
const HEX_HYSTERESIS_FRACTION = 0.18;
const CURSOR_MIN_CUTOFF = 1.5;
const CURSOR_BETA = 0.01;
const CURSOR_D_CUTOFF = 1.0;

// Chord-selection state (task 3.4). The left hand's extended-finger count sets
// the chord *quality* (ADR-0011); the hovered hex cell sets the *root*. Both
// feed a `ChordLatch` (ADR-0012) as the live "pending" selection, but the
// *sounding* chord only commits on a strum boundary (see processStrum), so it
// never changes mid-ring. `fingerCount` is reset on chord-hand loss (ADR-0011);
// the latch is deliberately NOT reset per-frame so a brief dropout can't drop
// the ringing chord.
let fingerCount: FingerCountDetectorInstance | null = null;
let chordLatch: ChordLatchInstance | null = null;
const FINGER_COUNT_HOLD_FRAMES = 3;

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

  // Chord flower in the left zone (task 3.2): draw the 7-cell hex flower, track
  // the left hand's smoothed palm cursor, highlight the hovered cell, and feed
  // the hovered root + finger-count quality into the chord latch as the live
  // pending selection (task 3.4).
  processChord(ctx, assignments, barH, width, height);

  // Strum detection → audio (task 2.4): feed the right hand's palm y to the
  // WASM strum detector and pluck a string voice for every crossing it reports.
  // Each strum is also the boundary at which the pending chord commits to the
  // sounding chord (task 3.4), so the chord never changes mid-ring.
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

  // Status bar skeleton (PRD §5). Chord reflects the *sounding* (committed) chord
  // — it only changes on a strum (task 3.4); the hovered-but-not-yet-strummed
  // cell is shown by the flower's accent. Instrument is a placeholder (Phase 5).
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

  // A strum boundary: commit the pending chord selection to the sounding chord
  // *before* the voices fire, so the strum that armed the change also sounds it
  // (task 3.4). Committing once per crossing frame is a no-op when the selection
  // hasn't moved. When the committed chord actually changes, load its six-string
  // note set into the audio engine (task 3.5) so this strum plays the new chord.
  if (events.length > 0 && chordLatch?.commit()) {
    applyCommittedChord();
  }

  for (const ev of events) {
    const index = ev.string_index;
    const velocity = ev.velocity;
    ev.free();
    audioEngine?.pluck(index, velocity);
  }
}

/**
 * Draw the hex chord flower and track the left (chord) hand's cursor (task 3.2).
 *
 * Rebuilds the WASM `HexMap` when the left-zone geometry changes (resize), maps
 * the chord hand's palm centre into canvas pixels through the same cover-crop +
 * mirror transform as the overlay, One-Euro-smooths it (ADR-0006), and feeds it
 * to `HexMap.update()` to get the hovered cell with border hysteresis, and feeds
 * that hovered root plus the finger-count quality into the chord latch as the
 * live pending selection (task 3.4). When no chord hand is tracked it resets the
 * selector + filters + finger-count detector so a hand re-entering the frame
 * doesn't snap the cursor across the flower; the latch is left alone so the
 * sounding chord persists.
 */
function processChord(
  ctx: CanvasRenderingContext2D,
  assignments: AssignedHand[],
  barH: number,
  width: number,
  height: number,
): void {
  if (!engineReady) return;

  // (Re)build the hex flower when the left-zone rectangle changes.
  const layout = computeHexFlowerLayout(0, barH, width / 2, height);
  const sig = `${Math.round(layout.cx)},${Math.round(layout.cy)},${Math.round(
    layout.radius,
  )}`;
  if (!hexMap || sig !== hexGeometry) {
    hexMap?.free();
    hexMap = new HexMap(
      layout.cx,
      layout.cy,
      layout.radius,
      layout.radius * HEX_HYSTERESIS_FRACTION,
    );
    hexGeometry = sig;
  }
  if (!cursorFilterX) {
    cursorFilterX = new OneEuroFilter(CURSOR_MIN_CUTOFF, CURSOR_BETA, CURSOR_D_CUTOFF);
  }
  if (!cursorFilterY) {
    cursorFilterY = new OneEuroFilter(CURSOR_MIN_CUTOFF, CURSOR_BETA, CURSOR_D_CUTOFF);
  }
  if (!fingerCount) {
    fingerCount = new FingerCountDetector(FINGER_COUNT_HOLD_FRAMES);
  }
  if (!chordLatch) {
    chordLatch = new ChordLatch();
  }

  const chordHand = assignments.find((a) => a.role === "chord");
  const lm =
    chordHand && latestHands ? latestHands.landmarks[chordHand.index] : undefined;

  let activeIndex = -1;
  let cursor: { x: number; y: number } | null = null;

  if (webcam && chordHand && lm && lm[0] && lm[9]) {
    // Palm centre (wrist + middle-MCP mean), mapped through the same transform
    // the feed/overlay/strum point use so the cursor lines up with the flower.
    const palm = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
    const { videoWidth, videoHeight } = webcam.video;
    const raw = landmarkToCanvas(palm, videoWidth, videoHeight, width, height, true);
    const t = performance.now() / 1000;
    cursor = {
      x: cursorFilterX.filter(raw.x, t),
      y: cursorFilterY.filter(raw.y, t),
    };
    activeIndex = hexMap.update(cursor.x, cursor.y);
    // Chord *quality* from the extended-finger count (raw normalized landmarks;
    // the metric is scale/rotation invariant). Feed hovered root + quality to the
    // latch as the live pending selection — it won't sound until the next strum.
    const quality = fingerCount.update(flattenLandmarks(lm));
    chordLatch.setPending(activeIndex, quality);
  } else {
    // No tracked chord hand — re-seed selector + smoothing for a clean re-entry,
    // and the finger-count detector back to its default (ADR-0011). The latch is
    // intentionally left untouched so the sounding chord persists through a brief
    // dropout and the pending selection freezes rather than drifting to "none".
    hexMap.reset();
    cursorFilterX.reset();
    cursorFilterY.reset();
    fingerCount.reset();
  }

  const cellCount = hexMap.cellCount();
  const cells: HexCell[] = [];
  for (let i = 0; i < cellCount; i++) {
    cells.push({
      x: hexMap.centerX(i),
      y: hexMap.centerY(i),
      chord: hexMap.cellChord(i),
    });
  }
  drawHexFlower(ctx, cells, hexMap.radius(), activeIndex, cursor);
}

/**
 * Build the status-bar model for this frame. Chord reflects the *sounding*
 * (committed) chord from the latch — root letter + quality suffix, e.g. `C`,
 * `Cm`, `C7` — which only changes on a strum (task 3.4). Instrument is a
 * placeholder (Phase 5); tracking health reflects the real pipeline state.
 */
function buildStatusModel(assignments: AssignedHand[]): StatusBarModel {
  let tracking: string;
  if (cameraError) tracking = "camera off";
  else if (!webcam) tracking = "starting camera…";
  else if (!handTracker) tracking = "loading tracker…";
  else tracking = trackingSummary(assignments).label;

  return {
    chord: committedChordLabel(),
    mode: "Chord",
    instrument: "Acoustic",
    tracking,
  };
}

/**
 * The sounding chord's display label from the latch's committed selection: the
 * root cell's letter (via `HexMap.cellChord`) plus the quality suffix. Shows the
 * em-dash placeholder until the first chord has been strummed in.
 */
function committedChordLabel(): string {
  if (!chordLatch || !hexMap) return chordLabel(null, 0);
  const root = chordLatch.committedRoot;
  const letter = root >= 0 && root < hexMap.cellCount() ? hexMap.cellChord(root) : null;
  return chordLabel(letter, chordLatch.committedQuality);
}

/**
 * Load the latch's committed (sounding) chord into the audio engine's note set
 * (task 3.5). Maps the committed hex root cell to its chord letter
 * (`HexMap.cellChord`) and quality, resolves the fret-position table to six
 * per-string frequencies, and hands them to `setChord()`. Called on a strum
 * boundary after a chord *change* commits. If nothing valid is committed yet
 * (root < 0 — no cell ever hovered), the engine keeps its default open-string
 * test chord rather than being silenced.
 */
function applyCommittedChord(): void {
  if (!audioEngine || !chordLatch || !hexMap) return;
  const root = chordLatch.committedRoot;
  if (root < 0 || root >= hexMap.cellCount()) return;
  const letter = hexMap.cellChord(root);
  audioEngine.setChord(chordFrequencies(letter, chordLatch.committedQuality));
}

requestAnimationFrame(render);

// Release the camera when the page goes away.
window.addEventListener("beforeunload", () => {
  webcam?.stop();
  handTracker?.close();
  audioEngine?.close();
  strumDetector?.free();
  hexMap?.free();
  cursorFilterX?.free();
  cursorFilterY?.free();
  fingerCount?.free();
  chordLatch?.free();
});
