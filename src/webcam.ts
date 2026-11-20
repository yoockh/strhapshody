/**
 * Webcam capture (task 0.4).
 *
 * Owns the live camera: requests `getUserMedia`, drives a hidden <video>
 * element the render loop samples frames from, and exposes a clean stop().
 *
 * The browser-facing async bits (`startWebcam`) can't run without a real
 * camera and so are exercised by the Playwright e2e suite (task 7.1) with a
 * fake media device, not by unit tests. The error-classification logic
 * (`describeCameraError`) is a pure function and IS unit-tested — it's the
 * part that decides what the user sees when the camera can't be opened, which
 * is exactly the "graceful error if no camera permission" the task asks for.
 */

export interface WebcamHandle {
  /** Playing <video> element carrying the live stream; sample it per frame. */
  readonly video: HTMLVideoElement;
  /** The underlying media stream (so callers can inspect tracks if needed). */
  readonly stream: MediaStream;
  /** Stop all tracks and release the camera. Safe to call more than once. */
  stop(): void;
}

/**
 * Default capture constraints: a user-facing (front) camera at ~720p. These
 * are *ideals*, not hard requirements, so a camera that can't hit 720p still
 * opens at its nearest supported mode rather than failing with
 * OverconstrainedError. Audio is off — this app never records the mic.
 */
export const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    facingMode: "user",
  },
  audio: false,
};

/**
 * Map whatever `getUserMedia` (or our own pre-checks) threw into a short,
 * human-readable, actionable sentence. Pure: takes an error-ish value, returns
 * a string. Handles the standard `DOMException.name` values the spec defines
 * for `getUserMedia`, then falls back to the error's message, then to a
 * generic catch-all.
 */
export function describeCameraError(err: unknown): string {
  const name = readStringProp(err, "name");

  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "Camera permission was denied. Allow camera access in your browser, then reload.";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera was found. Connect a webcam, then reload.";
    case "NotReadableError":
    case "TrackStartError":
      return "The camera is in use by another app, or the hardware failed. Close anything else using the camera, then reload.";
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return "No camera matches the requested settings. Try a different camera.";
    case "AbortError":
      return "Starting the camera was aborted. Reload to try again.";
    default:
      break;
  }

  const message = readStringProp(err, "message");
  if (message) {
    return `Camera unavailable: ${message}`;
  }
  return "Camera unavailable for an unknown reason.";
}

/**
 * Request the camera and return a playing <video> handle once it has real
 * frame dimensions. Rejects (for the caller to pass to `describeCameraError`)
 * when the browser has no getUserMedia, permission is denied, or no device is
 * available.
 */
export async function startWebcam(
  constraints: MediaStreamConstraints = DEFAULT_CONSTRAINTS,
): Promise<WebcamHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    // Typically a non-secure context (not https / not localhost) or a very old
    // browser. Thrown as a plain Error so describeCameraError falls through to
    // its message.
    throw new Error(
      "this browser can't access the camera (getUserMedia unavailable — are you on https or localhost?)",
    );
  }

  const stream = await navigator.mediaDevices.getUserMedia(constraints);

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", ""); // iOS Safari attribute form

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const track of stream.getTracks()) {
      track.stop();
    }
    video.srcObject = null;
  };

  try {
    await video.play();
    await waitForVideoReady(video);
  } catch (err) {
    // Clean up the stream we already acquired before surfacing the failure.
    stop();
    throw err;
  }

  return { video, stream, stop };
}

/** Resolve once the <video> has non-zero frame dimensions to sample. */
function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("the <video> element failed to load the camera stream."));
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("error", onError);
  });
}

/** Safely read a string-valued property off an unknown error-ish value. */
function readStringProp(value: unknown, prop: string): string {
  if (typeof value === "object" && value !== null && prop in value) {
    const raw = (value as Record<string, unknown>)[prop];
    if (typeof raw === "string") {
      return raw;
    }
  }
  return "";
}
