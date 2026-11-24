import { describe, it, expect } from "vitest";
import {
  assignHands,
  representativeX,
  roleIsTracked,
  DEFAULT_HANDEDNESS_ROLE,
  type RawHand,
  type Handedness,
} from "./handedness.ts";
import type { Point2D } from "./handoverlay.ts";

/** 21 landmarks all at x (so representativeX === x), y centred. */
function lm(x: number): Point2D[] {
  return Array.from({ length: 21 }, () => ({ x, y: 0.5 }));
}

function hand(handedness: Handedness, score: number, videoX: number): RawHand {
  return { handedness, score, landmarks: lm(videoX) };
}

describe("representativeX", () => {
  it("averages wrist (0) and middle-MCP (9)", () => {
    const pts = lm(0.5);
    pts[0] = { x: 0.2, y: 0 };
    pts[9] = { x: 0.4, y: 0 };
    expect(representativeX(pts)).toBeCloseTo(0.3, 6);
  });

  it("falls back to 0.5 when no usable landmarks", () => {
    expect(representativeX([])).toBe(0.5);
  });

  it("uses the wrist alone when the MCP is missing", () => {
    expect(representativeX([{ x: 0.7, y: 0 }])).toBeCloseTo(0.7, 6);
  });
});

describe("assignHands — nominal", () => {
  it("returns [] for no hands", () => {
    expect(assignHands([])).toEqual([]);
  });

  it("two confident, distinct labels → assigned by handedness (mirror swap)", () => {
    // Raw-frame MediaPipe labels: Right → chord, Left → strum (DEFAULT map).
    const out = assignHands([
      hand("Right", 0.95, 0.7),
      hand("Left", 0.92, 0.3),
    ]);
    expect(out.map((a) => a.role)).toEqual(["chord", "strum"]);
    expect(out.every((a) => a.source === "handedness")).toBe(true);
    expect(out.map((a) => a.index)).toEqual([0, 1]);
  });

  it("single confident hand → role from its handedness label", () => {
    const out = assignHands([hand("Right", 0.9, 0.5)]);
    expect(out).toHaveLength(1);
    expect(out[0]!.role).toBe("chord");
    expect(out[0]!.source).toBe("handedness");
  });
});

describe("assignHands — screen-side backup (§13)", () => {
  it("two hands with the same label fall back to screen-side", () => {
    // Both labelled Right (a crossing-hands failure mode). videoX 0.2 → screenX
    // 0.8 (mirrored); videoX 0.8 → screenX 0.2. Smaller screenX → chord.
    const out = assignHands([
      hand("Right", 0.95, 0.2),
      hand("Right", 0.95, 0.8),
    ]);
    expect(out.every((a) => a.source === "screen-side")).toBe(true);
    // index1 is further screen-left (screenX 0.2) → chord; index0 → strum.
    expect(out[0]!.role).toBe("strum");
    expect(out[1]!.role).toBe("chord");
    // The two hands never collapse into the same role.
    expect(new Set(out.map((a) => a.role)).size).toBe(2);
  });

  it("low confidence on either hand forces screen-side even with distinct labels", () => {
    const out = assignHands([
      hand("Right", 0.4, 0.8), // screenX 0.2 → chord
      hand("Left", 0.95, 0.2), // screenX 0.8 → strum
    ]);
    expect(out.every((a) => a.source === "screen-side")).toBe(true);
    expect(out[0]!.role).toBe("chord");
    expect(out[1]!.role).toBe("strum");
  });

  it("single low-confidence hand → role from which screen half it's in", () => {
    // videoX 0.8, mirror → screenX 0.2 (< 0.5) → chord zone.
    const out = assignHands([hand("Left", 0.3, 0.8)]);
    expect(out[0]!.role).toBe("chord");
    expect(out[0]!.source).toBe("screen-side");
    expect(out[0]!.screenX).toBeCloseTo(0.2, 6);
  });
});

describe("assignHands — options", () => {
  it("mirror:false reports screenX without reflection", () => {
    const out = assignHands([hand("Right", 0.3, 0.8)], { mirror: false });
    expect(out[0]!.screenX).toBeCloseTo(0.8, 6);
    // Unmirrored: videoX 0.8 is the right half → strum.
    expect(out[0]!.role).toBe("strum");
  });

  it("roleMap override flips the mirror convention", () => {
    const flipped = { Left: "chord", Right: "strum" } as const;
    const out = assignHands([hand("Right", 0.9, 0.5)], { roleMap: flipped });
    expect(out[0]!.role).toBe("strum");
  });

  it("respects a custom minScore threshold", () => {
    // score 0.7 is confident at default 0.6 but not at 0.8.
    const strict = assignHands([hand("Right", 0.7, 0.8)], { minScore: 0.8 });
    expect(strict[0]!.source).toBe("screen-side");
    const loose = assignHands([hand("Right", 0.7, 0.8)], { minScore: 0.6 });
    expect(loose[0]!.source).toBe("handedness");
  });
});

describe("roleIsTracked + default map", () => {
  it("default map swaps MediaPipe labels for raw frames", () => {
    expect(DEFAULT_HANDEDNESS_ROLE.Right).toBe("chord");
    expect(DEFAULT_HANDEDNESS_ROLE.Left).toBe("strum");
  });

  it("reports which roles are present", () => {
    const out = assignHands([hand("Right", 0.9, 0.7), hand("Left", 0.9, 0.3)]);
    expect(roleIsTracked(out, "chord")).toBe(true);
    expect(roleIsTracked(out, "strum")).toBe(true);
    expect(roleIsTracked([], "chord")).toBe(false);
  });
});

describe("assignHands — left-handed (task 6.2)", () => {
  const opts = { leftHanded: true };

  it("swaps the label mapping: the user's right hand picks chords", () => {
    // MediaPipe "Left" = user's right hand (mirror convention).
    const r = assignHands([hand("Left", 0.95, 0.3), hand("Right", 0.95, 0.7)], opts);
    expect(r.find((a) => a.index === 0)!.role).toBe("chord");
    expect(r.find((a) => a.index === 1)!.role).toBe("strum");
    expect(r[0]!.source).toBe("handedness");
  });

  it("screen-side fallback puts chords on the right half", () => {
    // Same labels → screen side. videoX 0.2 → screenX 0.8 (right of screen).
    const r = assignHands([hand("Right", 0.95, 0.2), hand("Right", 0.95, 0.8)], opts);
    expect(r[0]!.screenX).toBeCloseTo(0.8, 6);
    expect(r[0]!.role).toBe("chord");
    expect(r[1]!.role).toBe("strum");
    expect(r[0]!.source).toBe("screen-side");
  });

  it("single low-confidence hand: right half → chord, left half → strum", () => {
    expect(assignHands([hand("Left", 0.2, 0.2)], opts)[0]!.role).toBe("chord");
    expect(assignHands([hand("Left", 0.2, 0.8)], opts)[0]!.role).toBe("strum");
  });

  it("right-handed default is unchanged", () => {
    expect(assignHands([hand("Left", 0.2, 0.2)])[0]!.role).toBe("strum");
    expect(assignHands([hand("Right", 0.95, 0.5)])[0]!.role).toBe(DEFAULT_HANDEDNESS_ROLE.Right);
  });
});
