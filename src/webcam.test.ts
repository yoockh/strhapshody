import { describe, expect, it } from "vitest";
import { describeCameraError } from "./webcam.ts";

/**
 * Unit tests for the graceful camera-failure messaging (task 0.4). The task
 * explicitly calls for a "graceful error if no camera permission", so the
 * mapping from a thrown DOMException to a user-facing, actionable sentence is
 * load-bearing behaviour — tested here with synthetic error objects (no real
 * camera in this environment).
 */
describe("describeCameraError", () => {
  const mkError = (name: string, message = "") => {
    const err = new Error(message || name);
    err.name = name;
    return err;
  };

  it("explains a denied permission and how to fix it", () => {
    const msg = describeCameraError(mkError("NotAllowedError"));
    expect(msg).toMatch(/permission was denied/i);
    expect(msg).toMatch(/allow camera access/i);
  });

  it("treats the legacy PermissionDeniedError name the same way", () => {
    expect(describeCameraError(mkError("PermissionDeniedError"))).toMatch(
      /permission was denied/i,
    );
  });

  it("explains a missing camera", () => {
    expect(describeCameraError(mkError("NotFoundError"))).toMatch(
      /no camera was found/i,
    );
  });

  it("explains a camera that is busy or hardware-failed", () => {
    expect(describeCameraError(mkError("NotReadableError"))).toMatch(
      /in use by another app|hardware failed/i,
    );
  });

  it("explains over-constrained capture settings", () => {
    expect(describeCameraError(mkError("OverconstrainedError"))).toMatch(
      /no camera matches/i,
    );
  });

  it("explains an aborted start", () => {
    expect(describeCameraError(mkError("AbortError"))).toMatch(/aborted/i);
  });

  it("falls back to the error message for unknown DOMException names", () => {
    const msg = describeCameraError(mkError("WeirdError", "something odd"));
    expect(msg).toBe("Camera unavailable: something odd");
  });

  it("falls back to a generic message when there is nothing to go on", () => {
    expect(describeCameraError(null)).toMatch(/unknown reason/i);
    expect(describeCameraError({})).toMatch(/unknown reason/i);
    expect(describeCameraError(undefined)).toMatch(/unknown reason/i);
  });

  it("handles a plain string / non-object throw without crashing", () => {
    expect(describeCameraError("boom")).toMatch(/unknown reason/i);
  });
});
