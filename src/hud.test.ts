import { describe, it, expect } from "vitest";
import { trackingSummary } from "./hud.ts";
import type { AssignedHand, HandRole } from "./handedness.ts";

function assigned(role: HandRole): AssignedHand {
  return {
    index: 0,
    role,
    handedness: role === "chord" ? "Right" : "Left",
    score: 0.9,
    screenX: role === "chord" ? 0.25 : 0.75,
    source: "handedness",
  };
}

describe("trackingSummary", () => {
  it("reports no hands when nothing is assigned", () => {
    const s = trackingSummary([]);
    expect(s.chord).toBe(false);
    expect(s.strum).toBe(false);
    expect(s.label).toBe("no hands");
  });

  it("reports left hand only when just the chord role is tracked", () => {
    const s = trackingSummary([assigned("chord")]);
    expect(s.chord).toBe(true);
    expect(s.strum).toBe(false);
    expect(s.label).toBe("left hand only");
  });

  it("reports right hand only when just the strum role is tracked", () => {
    const s = trackingSummary([assigned("strum")]);
    expect(s.chord).toBe(false);
    expect(s.strum).toBe(true);
    expect(s.label).toBe("right hand only");
  });

  it("reports both hands when both roles are tracked", () => {
    const s = trackingSummary([assigned("chord"), assigned("strum")]);
    expect(s.chord).toBe(true);
    expect(s.strum).toBe(true);
    expect(s.label).toBe("OK · both hands");
  });
});
