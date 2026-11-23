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
  PowerStrip,
  renderPluck,
  distortionCurve,
  reverbImpulse,
  GestureDetector,
  type GestureDetectorInstance,
  type StrumDetectorInstance,
  type HexMapInstance,
  type OneEuroFilterInstance,
  type FingerCountDetectorInstance,
  type ChordLatchInstance,
  type PowerStripInstance,
} from "./engine.ts";
import {
  computeHexFlowerLayout,
  drawHexFlower,
  type HexCell,
} from "./hexflower.ts";
import {
  computeLeftZoneLayout,
  drawPowerStrip,
  nextPlayMode,
  rectContains,
  type PlayMode,
} from "./powerstrip.ts";
import { NO_CHORD_LABEL } from "./chord.ts";
import { powerChordLabel, selectVoicing, type PowerSelection } from "./voicing.ts";
import { createAudioEngine, INSTRUMENT_LABELS, type AudioEngine } from "./audio.ts";
import {
  DEFAULT_SETTINGS,
  hexScale,
  SETTINGS_STORAGE_KEY,
  smoothingMinCutoff,
  strumMinVelocity,
  validateSettings,
  type Settings,
} from "./settings.ts";
import { mountControls } from "./controls.ts";
import {
  CALIBRATION_STORAGE_KEY,
  calibratedZones,
  CalibrationSession,
  drawCalibrationOverlay,
  mirrorBox,
  validateCalibration,
  type Calibration,
  type PlayZones,
} from "./calibration.ts";
import { browserStorage, loadJSON, saveJSON } from "./storage.ts";
import { modeLabel, SHAPE_NEUTRAL, strumGestureAction } from "./strumgesture.ts";
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
// Right-hand shape (task 2.3 engine module, wired here): open palm = palm mute,
// fist = stop (PRD §8). Debounced in the engine; reset on strum-hand loss.
let gestureDetector: GestureDetectorInstance | null = null;
let strumShape = SHAPE_NEUTRAL;
const GESTURE_HOLD_FRAMES = 3;

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

// Power-chord strip + mode state (tasks 4.2/4.3). A horizontal strip above the
// hex flower (ADR-0013): when the left-hand cursor is over it the app is in
// Power mode, when it returns to the hex area it's back in Chord mode (the
// neutral gap between holds the current mode, for hysteresis). The strip is
// rebuilt when the left-zone geometry changes.
let powerStrip: PowerStripInstance | null = null;
let powerGeometry = "";
let powerMarkerXs: number[] = [];
let playMode: PlayMode = "Chord";
// Highest selectable fret (PRD §7: "0 to 12").
const POWER_STRIP_MAX_FRET = 12;
// The hovered power chord (task 4.3): the last valid fret + string set under the
// cursor while on the strip. Held when the cursor drifts into the gap (mode is
// held too) so a strum there still sounds the last power chord. Like the hex
// chord it only *sounds* on the next strum boundary (see processStrum).
let pendingPower: PowerSelection | null = null;

// The voicing currently loaded in the audio engine (task 4.3): its identity key
// (so a strum only reloads the engine when the voicing actually changes, e.g.
// Power→Chord with an unchanged latched chord still swaps the note set back)
// and its status-bar label ("Am", "G5 (fret 3, low E)").
let soundingKey = "";
let soundingLabel = NO_CHORD_LABEL;

// Calibration (task 6.1): each hand's comfortable range, persisted, which the
// play zones are fitted to. Runs automatically on first use (no saved
// calibration) once hand tracking is live; the Calibrate button reruns it and
// Esc cancels. Strumming is paused while it runs.
const storage = browserStorage();

// User settings (task 6.2): handedness, sensitivity, sound — persisted.
let settings: Settings =
  loadJSON(storage, SETTINGS_STORAGE_KEY, validateSettings) ?? DEFAULT_SETTINGS;

let calibration: Calibration | null = loadJSON(
  storage,
  CALIBRATION_STORAGE_KEY,
  validateCalibration,
);
let calibrationSession: CalibrationSession | null = null;
// First-run auto-start fires at most once per page load (so Esc sticks).
let autoCalibrationOffered = calibration !== null;

function startCalibration(): void {
  if (!webcam || !handTracker) return; // needs live tracking
  calibrationSession = new CalibrationSession(performance.now() / 1000);
  autoCalibrationOffered = true;
}

function endCalibration(save: boolean): void {
  if (calibrationSession && save) {
    const result = calibrationSession.result(settings.leftHanded);
    // A hand that wasn't seen keeps its previous range (or the default),
    // mirrored first if it was recorded with the other handedness.
    const flip = (calibration?.leftHanded ?? false) !== settings.leftHanded;
    const prev = (b: Calibration["chord"] | undefined) => (b && flip ? mirrorBox(b) : b ?? null);
    const merged: Calibration = {
      version: 1,
      chord: result.chord ?? prev(calibration?.chord),
      strum: result.strum ?? prev(calibration?.strum),
      leftHanded: settings.leftHanded,
    };
    if (merged.chord || merged.strum) {
      calibration = merged;
      saveJSON(storage, CALIBRATION_STORAGE_KEY, merged);
    }
  }
  calibrationSession = null;
  // The strum detector didn't see the hand while calibrating: re-seed it so
  // the first frame back can't register as one giant strum (ADR-0007).
  strumDetector?.reset();
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && calibrationSession) endCalibration(false);
});

try {
  audioEngine = createAudioEngine();
} catch (err) {
  console.warn("[strhapshody] audio unavailable:", err);
}

/**
 * Apply a settings change (task 6.2) and persist it. Sound settings go to the
 * audio engine; smoothing rebuilds the cursor filters; a handedness change
 * swaps the zones, so every per-hand detector is re-seeded. Strum threshold
 * and hex size are read each frame.
 */
function applySettings(patch: Partial<Settings>): void {
  const prev = settings;
  settings = { ...settings, ...patch };
  saveJSON(storage, SETTINGS_STORAGE_KEY, settings);
  audioEngine?.setInstrument(settings.instrument);
  audioEngine?.setVolume(settings.volume);
  audioEngine?.setReverb(settings.reverb);
  if (settings.smoothing !== prev.smoothing) {
    cursorFilterX?.free();
    cursorFilterY?.free();
    cursorFilterX = null;
    cursorFilterY = null;
  }
  if (settings.leftHanded !== prev.leftHanded) {
    strumDetector?.reset();
    hexMap?.reset();
    cursorFilterX?.reset();
    cursorFilterY?.reset();
    fingerCount?.reset();
    gestureDetector?.reset();
    strumShape = SHAPE_NEUTRAL;
  }
}
// Push the loaded sound settings into the engine.
applySettings({});

// Control panel (tasks 5.3 / 6.1 / 6.2): instrument (buttons + 1/2/3/I keys),
// volume, reverb, Calibrate, and the Settings section.
mountControls(document.body, {
  settings,
  onChange: applySettings,
  onCalibrate: () => startCalibration(),
});

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
    // Swap the placeholder oscillator for the Karplus-Strong voice (task 5.1).
    audioEngine?.setPluckRenderer(renderPluck);
    // And the waveshaper curve for the electric/distortion voice (task 5.2).
    audioEngine?.setCurveGenerator(distortionCurve);
    // And the reverb impulse response (task 5.3).
    audioEngine?.setImpulseGenerator(reverbImpulse);
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

// Set on page teardown: the wasm objects are freed then, so the render loop
// must not run another frame against them ("null pointer passed to rust").
let disposed = false;

function render(): void {
  if (disposed) return;
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
        assignments = assignHands(toRawHands(latestHands), {
          leftHanded: settings.leftHanded,
        });
      }
    }
  } else {
    stage.withMirroredFeed((c) => drawFeedPattern(c, width, height));
  }

  // Un-mirrored overlay. Zone tint + active-zone highlight first (behind the
  // divider, labels, and skeleton), driven by the live assignments.
  const activeRoles = new Set<HandRole>(assignments.map((a) => a.role));
  drawZoneSplit(ctx, width, height, activeRoles, 0, settings.leftHanded);

  // Centre divider, zone labels, and (while starting) a status caption.
  const caption = webcam || cameraError ? undefined : "starting camera…";
  drawZoneOverlay(ctx, width, height, caption, settings.leftHanded);

  // Play zones (task 6.1): halves below the status bar until calibrated, then
  // fitted to each hand's recorded comfortable range.
  const barH = statusBarHeight(height);
  const zones = calibratedZones(calibration, width, height, barH, settings.leftHanded);

  // First-run calibration starts by itself once hand tracking is live.
  if (!autoCalibrationOffered && webcam && handTracker) startCalibration();

  // Six virtual strings across the right (strum) zone (PRD §8 / task 2.1).
  drawStrings(ctx, zones.strum.left, zones.strum.right, zones.strum.top, zones.strum.bottom);

  // Chord flower in the left zone (task 3.2): draw the 7-cell hex flower, track
  // the left hand's smoothed palm cursor, highlight the hovered cell, and feed
  // the hovered root + finger-count quality into the chord latch as the live
  // pending selection (task 3.4).
  processChord(ctx, assignments, zones, width, height);

  // Strum detection → audio (task 2.4): feed the right hand's palm y to the
  // WASM strum detector and pluck a string voice for every crossing it reports.
  // Each strum is also the boundary at which the pending chord commits to the
  // sounding chord (task 3.4), so the chord never changes mid-ring. Paused
  // while calibrating.
  if (!calibrationSession) processStrum(assignments, zones, width, height);

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
  // cell is shown by the flower's accent. Instrument follows the audio engine (task 5.3).
  drawStatusBar(ctx, width, height, buildStatusModel(assignments));

  // Calibration overlay + sampling (task 6.1), on top of everything.
  if (calibrationSession) {
    const view = calibrationSession.update(
      performance.now() / 1000,
      palmNormalized(assignments, "chord", width, height),
      palmNormalized(assignments, "strum", width, height),
    );
    if (view.finished) endCalibration(true);
    else drawCalibrationOverlay(ctx, width, height, view, settings.leftHanded);
  }

  // Graceful error path: permission denied, no device, camera in use, etc.
  if (cameraError) {
    drawErrorBanner(ctx, width, height, "Camera unavailable", cameraError);
  }

  requestAnimationFrame(render);
}

/**
 * The palm centre (wrist + middle-MCP mean) of the hand assigned to `role`,
 * normalised to the canvas (0..1, mirrored as the user sees it), or null if
 * that hand isn't tracked. Used to record calibration ranges (task 6.1).
 */
function palmNormalized(
  assignments: AssignedHand[],
  role: HandRole,
  width: number,
  height: number,
): { x: number; y: number } | null {
  const hand = assignments.find((a) => a.role === role);
  const lm = hand && latestHands ? latestHands.landmarks[hand.index] : undefined;
  if (!webcam || !lm || !lm[0] || !lm[9] || width <= 0 || height <= 0) return null;
  const palm = { x: (lm[0].x + lm[9].x) / 2, y: (lm[0].y + lm[9].y) / 2 };
  const { videoWidth, videoHeight } = webcam.video;
  const p = landmarkToCanvas(palm, videoWidth, videoHeight, width, height, true);
  return { x: p.x / width, y: p.y / height };
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
  zones: PlayZones,
  width: number,
  height: number,
): void {
  if (!engineReady) return;

  // (Re)build the detector when the six string-line y positions change.
  const stringYs = computeStringYs(zones.strum.top, zones.strum.bottom);
  const sig = stringYs.map((y) => Math.round(y)).join(",");
  if (!strumDetector || sig !== strumGeometry) {
    strumDetector?.free();
    strumDetector = new StrumDetector(new Float64Array(stringYs));
    strumGeometry = sig;
  }
  // Strum threshold (task 6.2): ignore crossings slower than this.
  strumDetector.setMinVelocity(strumMinVelocity(settings.strumThreshold, height));

  const strumHand = assignments.find((a) => a.role === "strum");
  const lm =
    strumHand && latestHands ? latestHands.landmarks[strumHand.index] : undefined;

  if (!gestureDetector) gestureDetector = new GestureDetector(GESTURE_HOLD_FRAMES);

  if (!webcam || !strumHand || !lm || !lm[0] || !lm[9]) {
    // No tracked strum hand this frame — re-seed so the next push doesn't jump,
    // and drop any palm-mute / stop modifier with the hand.
    strumDetector.reset();
    gestureDetector.reset();
    strumShape = SHAPE_NEUTRAL;
    return;
  }

  // Hand shape → fist stop / palm mute (PRD §8).
  const shape: number = gestureDetector.update(flattenLandmarks(lm));
  const gesture = strumGestureAction(strumShape, shape);
  strumShape = shape;
  if (gesture.stopAll) audioEngine?.stopAll();

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
  // (task 3.4), then load whichever voicing this strum should play — the power
  // chord in Power mode, the latched hex chord otherwise (tasks 3.5/4.3). In
  // Power mode the voicing only has the 2–3 power-chord strings non-zero, so the
  // plucks below on any other string are silent: that's the strum restriction.
  if (events.length > 0 && !gesture.suppressPlucks) {
    chordLatch?.commit();
    applySoundingVoicing();
  }

  for (const ev of events) {
    const index = ev.string_index;
    const velocity = ev.velocity;
    ev.free();
    if (!gesture.suppressPlucks) audioEngine?.pluck(index, velocity, gesture.muted);
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
  zones: PlayZones,
  width: number,
  height: number,
): void {
  if (!engineReady) return;

  // Carve the left zone into a power-strip band (top) and the hex-flower area
  // (below), with a neutral gap between for mode-switch hysteresis (task 4.2).
  // The zone itself is the calibrated left zone (task 6.1).
  const zone = computeLeftZoneLayout(
    zones.chord.left,
    zones.chord.top,
    zones.chord.right,
    zones.chord.bottom,
  );

  // (Re)build the power strip when its rectangle changes, caching the fret
  // marker centres for the renderer.
  const stripSig = `${Math.round(zone.strip.left)},${Math.round(
    zone.strip.top,
  )},${Math.round(zone.strip.right)},${Math.round(zone.strip.bottom)}`;
  if (!powerStrip || stripSig !== powerGeometry) {
    powerStrip?.free();
    powerStrip = new PowerStrip(
      zone.strip.left,
      zone.strip.top,
      zone.strip.right,
      zone.strip.bottom,
      POWER_STRIP_MAX_FRET,
    );
    powerGeometry = stripSig;
    const count = powerStrip.fretCount();
    powerMarkerXs = [];
    for (let f = 0; f < count; f++) powerMarkerXs.push(powerStrip.fretMarkerX(f));
  }

  // (Re)build the hex flower when the (now strip-reduced) hex area changes.
  const layout = computeHexFlowerLayout(
    zone.hexArea.left,
    zone.hexArea.top,
    zone.hexArea.right,
    zone.hexArea.bottom,
  );
  // Hex size setting (task 6.2) scales the largest flower that fits.
  const radius = layout.radius * hexScale(settings.hexSize);
  const sig = `${Math.round(layout.cx)},${Math.round(layout.cy)},${Math.round(radius)}`;
  if (!hexMap || sig !== hexGeometry) {
    hexMap?.free();
    hexMap = new HexMap(layout.cx, layout.cy, radius, radius * HEX_HYSTERESIS_FRACTION);
    hexGeometry = sig;
  }
  // Smoothing setting (task 6.2) sets the cursor filters' min cutoff; they're
  // nulled on change and rebuilt here.
  const minCutoff = smoothingMinCutoff(settings.smoothing);
  if (!cursorFilterX) {
    cursorFilterX = new OneEuroFilter(minCutoff, CURSOR_BETA, CURSOR_D_CUTOFF);
  }
  if (!cursorFilterY) {
    cursorFilterY = new OneEuroFilter(minCutoff, CURSOR_BETA, CURSOR_D_CUTOFF);
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

  // Mode switch (task 4.2): cursor on the strip → Power, in the hex area →
  // Chord, in the gap / no hand → hold the current mode (ADR-0013 hysteresis).
  const inStrip = cursor ? powerStrip.contains(cursor.x, cursor.y) : false;
  const inHexArea = rectContains(zone.hexArea, cursor);
  playMode = nextPlayMode(playMode, inStrip, inHexArea);

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

  // The power strip above the flower, accented + showing the hovered fret column
  // and a preview of the power chord the next strum will sound (task 4.3).
  let activeFret = -1;
  let activePair = -1;
  if (playMode === "Power" && cursor) {
    activeFret = powerStrip.fretAtX(cursor.x);
    activePair = powerStrip.pairAtY(cursor.y);
    // Hold the last valid hover (gap / off-strip frames keep it, task 4.3).
    if (activeFret >= 0 && activePair >= 0) {
      pendingPower = {
        fret: activeFret,
        rootString: powerStrip.rootString(activePair),
        fifthString: powerStrip.fifthString(activePair),
        octaveString: powerStrip.octaveString(activePair),
      };
    }
  }
  drawPowerStrip(
    ctx,
    { rect: zone.strip, markerXs: powerMarkerXs },
    playMode === "Power",
    activeFret,
    activePair,
    playMode === "Power" && pendingPower
      ? powerChordLabel(pendingPower.fret, pendingPower.rootString)
      : null,
  );
}

/**
 * Build the status-bar model for this frame. Chord reflects the *sounding*
 * voicing — `C`, `Cm`, `C7`, or a power chord like `G5 (fret 3, low E)` — which
 * only changes on a strum (tasks 3.4/4.3). Instrument is the audio engine's
 * current instrument (task 5.3); tracking health reflects the real pipeline.
 */
function buildStatusModel(assignments: AssignedHand[]): StatusBarModel {
  let tracking: string;
  if (cameraError) tracking = "camera off";
  else if (!webcam) tracking = "starting camera…";
  else if (!handTracker) tracking = "loading tracker…";
  else tracking = trackingSummary(assignments).label;

  return {
    chord: soundingLabel,
    mode: modeLabel(playMode, strumShape),
    instrument: audioEngine ? INSTRUMENT_LABELS[audioEngine.instrument] : "no audio",
    tracking,
  };
}

/**
 * Load the voicing this strum should sound into the audio engine (tasks 3.5 /
 * 4.3): the hovered power chord in Power mode, otherwise the latch's committed
 * hex chord (root cell letter via `HexMap.cellChord` + quality). Only reloads
 * when the voicing's identity changes, and updates the status-bar label. If
 * nothing valid is selected yet the engine keeps its default open-string test
 * chord rather than being silenced.
 */
function applySoundingVoicing(): void {
  if (!chordLatch || !hexMap) return;
  const root = chordLatch.committedRoot;
  const letter = root >= 0 && root < hexMap.cellCount() ? hexMap.cellChord(root) : null;
  const voicing = selectVoicing(
    playMode,
    pendingPower,
    { root: letter, quality: chordLatch.committedQuality },
    settings.powerOctave,
  );
  if (!voicing || voicing.key === soundingKey) return;
  audioEngine?.setChord(voicing.frequencies);
  soundingKey = voicing.key;
  soundingLabel = voicing.label;
}

requestAnimationFrame(render);

// Release the camera when the page goes away. Stop the render loop *first*:
// a frame scheduled after the frees below would call into freed wasm objects.
window.addEventListener("beforeunload", () => {
  disposed = true;
  engineReady = false;
  webcam?.stop();
  handTracker?.close();
  audioEngine?.close();
  strumDetector?.free();
  hexMap?.free();
  cursorFilterX?.free();
  cursorFilterY?.free();
  fingerCount?.free();
  chordLatch?.free();
  powerStrip?.free();
  gestureDetector?.free();
});
