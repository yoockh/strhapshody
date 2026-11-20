/**
 * Hand tracking (task 1.1) — the MediaPipe HandLandmarker wrapper.
 *
 * Owns the WASM-backed, browser-only side of hand tracking: loading the
 * `@mediapipe/tasks-vision` vision fileset + the hand-landmark model, and
 * running per-frame detection against the live <video> element. Per ADR-0002
 * this layer stays thin and is NOT unit-tested — it needs the WASM runtime, a
 * GPU/CPU delegate, and real camera frames, none of which exist in this
 * execution environment. It's exercised by the Playwright e2e suite (task 7.1)
 * with a fake media device, and by a human with a real camera (task 7.3). The
 * pure, testable coordinate/overlay math lives in `handoverlay.ts`.
 *
 * Assets load from the jsDelivr CDN (wasm fileset) and Google's model storage
 * (the `.task` file), pinned to the installed package version so the loader
 * and binaries match. This matches MediaPipe's documented web setup and avoids
 * vendoring multi-megabyte binaries into the repo over a slow connection
 * (see DECISIONS ADR-0001 on bandwidth constraints).
 */

import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";

/** Pinned to the installed @mediapipe/tasks-vision version (see package.json). */
export const MEDIAPIPE_VERSION = "0.10.35";

/** CDN base holding `vision_wasm_internal.{js,wasm}` for the loader. */
export const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;

/** Google-hosted hand-landmark model (float16, 1-stage). */
export const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export interface HandTrackerOptions {
  /** Max hands to detect. PRD uses both hands (left=chords, right=strum). */
  readonly numHands?: number;
  /** "GPU" (default, fast) or "CPU" (more compatible). */
  readonly delegate?: "GPU" | "CPU";
  readonly minHandDetectionConfidence?: number;
  readonly minTrackingConfidence?: number;
  readonly minHandPresenceConfidence?: number;
}

export interface HandTracker {
  /**
   * Run detection on the current video frame. `timestampMs` must strictly
   * increase between calls (MediaPipe VIDEO mode requirement); stale/duplicate
   * timestamps are skipped and return `null` rather than throwing.
   */
  detect(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult | null;
  /** Release the underlying WASM graph. Safe to call more than once. */
  close(): void;
}

/**
 * Create a HandLandmarker configured for streaming video with both hands.
 * Rejects if the WASM fileset or model can't be loaded (e.g. offline) — the
 * caller falls back to showing the feed without an overlay.
 */
export async function createHandTracker(
  options: HandTrackerOptions = {},
): Promise<HandTracker> {
  const {
    numHands = 2,
    delegate = "GPU",
    minHandDetectionConfidence = 0.5,
    minTrackingConfidence = 0.5,
    minHandPresenceConfidence = 0.5,
  } = options;

  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_URL);
  const landmarker = await HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands,
    minHandDetectionConfidence,
    minTrackingConfidence,
    minHandPresenceConfidence,
  });

  let lastTimestamp = -1;
  let closed = false;

  return {
    detect(video, timestampMs) {
      if (closed) return null;
      // VIDEO mode demands strictly increasing timestamps.
      if (timestampMs <= lastTimestamp) return null;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;
      lastTimestamp = timestampMs;
      return landmarker.detectForVideo(video, timestampMs);
    },
    close() {
      if (closed) return;
      closed = true;
      landmarker.close();
    },
  };
}
