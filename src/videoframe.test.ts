import { describe, expect, it } from "vitest";
import { computeCoverCrop } from "./videoframe.ts";

/**
 * Unit tests for the pure cover-fit math (task 0.4). These guarantee the
 * webcam frame fills the canvas without distortion or letterboxing, which is
 * the part a camera-less agent can actually verify.
 */
describe("computeCoverCrop", () => {
  it("returns the full frame when aspect ratios match", () => {
    const crop = computeCoverCrop(100, 100, 50, 50);
    expect(crop).toEqual({ sx: 0, sy: 0, sw: 100, sh: 100 });
  });

  it("crops top/bottom when the destination is wider than the source", () => {
    // 1:1 source into a 2:1 destination → keep full width, crop height.
    const crop = computeCoverCrop(100, 100, 200, 100);
    expect(crop.sx).toBe(0);
    expect(crop.sw).toBe(100);
    expect(crop.sh).toBe(50);
    expect(crop.sy).toBe(25); // centred vertically
  });

  it("crops left/right when the destination is taller than the source", () => {
    // 2:1 source into a 1:1 destination → keep full height, crop width.
    const crop = computeCoverCrop(200, 100, 100, 100);
    expect(crop.sy).toBe(0);
    expect(crop.sh).toBe(100);
    expect(crop.sw).toBe(100);
    expect(crop.sx).toBe(50); // centred horizontally
  });

  it("maps a 16:9 webcam frame onto a portrait canvas (keeps full height)", () => {
    const crop = computeCoverCrop(1280, 720, 400, 800);
    // Portrait dest, landscape source → full height used, sides cropped.
    expect(crop.sh).toBeCloseTo(720);
    expect(crop.sw).toBeCloseTo(360);
    expect(crop.sx).toBeCloseTo(460);
    expect(crop.sy).toBeCloseTo(0);
  });

  it("keeps the cropped region centred (symmetric margins)", () => {
    const crop = computeCoverCrop(300, 100, 100, 100);
    const rightMargin = 300 - (crop.sx + crop.sw);
    expect(crop.sx).toBeCloseTo(rightMargin);
  });

  it("returns a safe crop for degenerate (zero / not-yet-ready) dimensions", () => {
    expect(computeCoverCrop(0, 0, 640, 480)).toEqual({
      sx: 0,
      sy: 0,
      sw: 0,
      sh: 0,
    });
    const noDest = computeCoverCrop(640, 480, 0, 0);
    expect(Number.isFinite(noDest.sw)).toBe(true);
    expect(Number.isFinite(noDest.sh)).toBe(true);
  });
});
