import { describe, it, expect } from "vitest";
import {
  HAND_CONNECTIONS,
  LANDMARKS_PER_HAND,
  landmarkToCanvas,
} from "./handoverlay.ts";
import { computeCoverCrop } from "./videoframe.ts";

describe("HAND_CONNECTIONS", () => {
  it("references only valid landmark indices (0..20)", () => {
    for (const [a, b] of HAND_CONNECTIONS) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(LANDMARKS_PER_HAND);
      expect(b).toBeLessThan(LANDMARKS_PER_HAND);
      expect(a).not.toBe(b);
    }
  });

  it("forms a connected skeleton reaching every joint from the wrist (0)", () => {
    // Treat connections as an undirected graph and BFS from the wrist; every
    // one of the 21 landmarks must be reachable (no stray/disconnected joint).
    const adj = new Map<number, number[]>();
    const link = (from: number, to: number) => {
      const list = adj.get(from) ?? [];
      list.push(to);
      adj.set(from, list);
    };
    for (const [a, b] of HAND_CONNECTIONS) {
      link(a, b);
      link(b, a);
    }
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj.get(n) ?? []) {
        if (!seen.has(m)) {
          seen.add(m);
          queue.push(m);
        }
      }
    }
    expect(seen.size).toBe(LANDMARKS_PER_HAND);
  });
});

describe("landmarkToCanvas", () => {
  it("maps the frame centre to the canvas centre (no mirror)", () => {
    // Square source into square canvas: no cropping, centre maps to centre.
    const p = landmarkToCanvas({ x: 0.5, y: 0.5 }, 480, 480, 480, 480, false);
    expect(p.x).toBeCloseTo(240);
    expect(p.y).toBeCloseTo(240);
  });

  it("reflects x about the canvas centre when mirrored", () => {
    const plain = landmarkToCanvas({ x: 0.25, y: 0.1 }, 640, 640, 800, 800, false);
    const mirrored = landmarkToCanvas({ x: 0.25, y: 0.1 }, 640, 640, 800, 800, true);
    expect(mirrored.x).toBeCloseTo(800 - plain.x);
    expect(mirrored.y).toBeCloseTo(plain.y); // mirror leaves y untouched
  });

  it("mirrors the centre point onto itself", () => {
    const p = landmarkToCanvas({ x: 0.5, y: 0.3 }, 1280, 720, 1000, 1000, true);
    expect(p.x).toBeCloseTo(500);
  });

  it("is consistent with the cover crop used to draw the video", () => {
    // A landmark sitting exactly on the top-left corner of the *visible* crop
    // must map to the canvas top-left (0,0) when not mirrored.
    const videoW = 1280;
    const videoH = 720;
    const dstW = 600;
    const dstH = 800; // portrait canvas => crops left/right off the wide frame
    const crop = computeCoverCrop(videoW, videoH, dstW, dstH);
    const corner = { x: crop.sx / videoW, y: crop.sy / videoH };
    const p = landmarkToCanvas(corner, videoW, videoH, dstW, dstH, false);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it("pushes cropped-out landmarks outside the canvas (not clamped)", () => {
    // Portrait canvas crops the sides of a landscape frame; x=0 (far left of
    // the frame) is off the left edge of the visible crop, so canvas x < 0.
    const p = landmarkToCanvas({ x: 0, y: 0.5 }, 1280, 720, 600, 800, false);
    expect(p.x).toBeLessThan(0);
  });

  it("returns the origin for degenerate dimensions instead of NaN", () => {
    for (const bad of [
      landmarkToCanvas({ x: 0.5, y: 0.5 }, 0, 480, 480, 480, false),
      landmarkToCanvas({ x: 0.5, y: 0.5 }, 480, 0, 480, 480, false),
      landmarkToCanvas({ x: 0.5, y: 0.5 }, 480, 480, 0, 480, false),
      landmarkToCanvas({ x: 0.5, y: 0.5 }, 480, 480, 480, 0, false),
    ]) {
      expect(bad).toEqual({ x: 0, y: 0 });
      expect(Number.isNaN(bad.x)).toBe(false);
      expect(Number.isNaN(bad.y)).toBe(false);
    }
  });
});
