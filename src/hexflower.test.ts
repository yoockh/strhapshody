import { describe, it, expect } from "vitest";
import {
  flatTopHexVertices,
  computeHexFlowerLayout,
  FLOWER_WIDTH_IN_R,
  FLOWER_HEIGHT_IN_R,
} from "./hexflower.ts";

const SQRT_3 = Math.sqrt(3);

describe("flatTopHexVertices", () => {
  it("returns exactly 6 vertices", () => {
    expect(flatTopHexVertices(0, 0, 10)).toHaveLength(6);
  });

  it("all vertices lie on the circumradius circle", () => {
    const cx = 100;
    const cy = 50;
    const r = 30;
    for (const v of flatTopHexVertices(cx, cy, r)) {
      const d = Math.hypot(v.x - cx, v.y - cy);
      expect(d).toBeCloseTo(r, 9);
    }
  });

  it("has a leftmost and rightmost vertex on the horizontal centre line", () => {
    const verts = flatTopHexVertices(0, 0, 10);
    // Vertex 0 is rightmost (angle 0), vertex 3 is leftmost (angle 180°).
    expect(verts[0]!.x).toBeCloseTo(10, 9);
    expect(verts[0]!.y).toBeCloseTo(0, 9);
    expect(verts[3]!.x).toBeCloseTo(-10, 9);
    expect(verts[3]!.y).toBeCloseTo(0, 9);
  });

  it("is flat-top: top and bottom edges are horizontal at ±√3/2·r", () => {
    const r = 12;
    const verts = flatTopHexVertices(0, 0, r);
    const apothem = (SQRT_3 / 2) * r;
    // Bottom edge: vertices 1 and 2 share y = +apothem (y-down screen coords).
    expect(verts[1]!.y).toBeCloseTo(apothem, 9);
    expect(verts[2]!.y).toBeCloseTo(apothem, 9);
    // Top edge: vertices 4 and 5 share y = -apothem.
    expect(verts[4]!.y).toBeCloseTo(-apothem, 9);
    expect(verts[5]!.y).toBeCloseTo(-apothem, 9);
    // The flat edges sit exactly at the engine's containment half-height.
    expect(apothem).toBeCloseTo((SQRT_3 / 2) * r, 12);
  });

  it("is centred on (cx, cy): vertices average back to the centre", () => {
    const cx = -7;
    const cy = 42;
    const verts = flatTopHexVertices(cx, cy, 9);
    const mx = verts.reduce((s, v) => s + v.x, 0) / verts.length;
    const my = verts.reduce((s, v) => s + v.y, 0) / verts.length;
    expect(mx).toBeCloseTo(cx, 9);
    expect(my).toBeCloseTo(cy, 9);
  });

  it("degenerate radius yields coincident centre points, never NaN", () => {
    for (const r of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const verts = flatTopHexVertices(3, 4, r);
      expect(verts).toHaveLength(6);
      for (const v of verts) {
        expect(v.x).toBe(3);
        expect(v.y).toBe(4);
      }
    }
  });
});

describe("computeHexFlowerLayout", () => {
  it("centres the flower in the rectangle", () => {
    const l = computeHexFlowerLayout(0, 100, 400, 900);
    expect(l.cx).toBeCloseTo(200, 9);
    expect(l.cy).toBeCloseTo(500, 9);
  });

  it("fits the full 5R × 3√3R bounding box inside the padded rectangle", () => {
    const left = 0;
    const top = 0;
    const right = 600;
    const bottom = 800;
    const padding = 0.08;
    const l = computeHexFlowerLayout(left, top, right, bottom, padding);
    const availW = (right - left) * (1 - 2 * padding);
    const availH = (bottom - top) * (1 - 2 * padding);
    // Neither the flower width nor its height may exceed the available box.
    expect(l.radius * FLOWER_WIDTH_IN_R).toBeLessThanOrEqual(availW + 1e-9);
    expect(l.radius * FLOWER_HEIGHT_IN_R).toBeLessThanOrEqual(availH + 1e-9);
  });

  it("is width-bound in a tall, narrow zone", () => {
    // Tall narrow zone: width is the binding dimension.
    const l = computeHexFlowerLayout(0, 0, 300, 2000, 0);
    expect(l.radius).toBeCloseTo(300 / FLOWER_WIDTH_IN_R, 9);
  });

  it("is height-bound in a wide, short zone", () => {
    // Wide short zone: height is the binding dimension.
    const l = computeHexFlowerLayout(0, 0, 3000, 200, 0);
    expect(l.radius).toBeCloseTo(200 / FLOWER_HEIGHT_IN_R, 9);
  });

  it("floors the radius to a positive value on a degenerate rectangle", () => {
    const l = computeHexFlowerLayout(50, 50, 50, 50);
    expect(l.radius).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(l.cx)).toBe(true);
    expect(Number.isFinite(l.cy)).toBe(true);
  });

  it("clamps an absurd padding fraction instead of producing a negative box", () => {
    const l = computeHexFlowerLayout(0, 0, 500, 700, 5);
    expect(l.radius).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(l.radius)).toBe(true);
  });
});
