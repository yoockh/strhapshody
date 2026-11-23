import { describe, expect, it } from "vitest";
import {
  modeLabel,
  SHAPE_FIST,
  SHAPE_NEUTRAL,
  SHAPE_OPEN_PALM,
  strumGestureAction,
} from "./strumgesture.ts";

describe("strumGestureAction", () => {
  it("neutral strums normally", () => {
    expect(strumGestureAction(SHAPE_NEUTRAL, SHAPE_NEUTRAL)).toEqual({
      stopAll: false,
      suppressPlucks: false,
      muted: false,
    });
  });

  it("closing into a fist stops everything once, then keeps plucks suppressed", () => {
    const enter = strumGestureAction(SHAPE_NEUTRAL, SHAPE_FIST);
    expect(enter.stopAll).toBe(true);
    expect(enter.suppressPlucks).toBe(true);
    const hold = strumGestureAction(SHAPE_FIST, SHAPE_FIST);
    expect(hold.stopAll).toBe(false);
    expect(hold.suppressPlucks).toBe(true);
  });

  it("palm → fist also stops", () => {
    expect(strumGestureAction(SHAPE_OPEN_PALM, SHAPE_FIST).stopAll).toBe(true);
  });

  it("open palm plucks muted and never stops", () => {
    const a = strumGestureAction(SHAPE_NEUTRAL, SHAPE_OPEN_PALM);
    expect(a).toEqual({ stopAll: false, suppressPlucks: false, muted: true });
  });

  it("opening a fist resumes normal strumming", () => {
    expect(strumGestureAction(SHAPE_FIST, SHAPE_NEUTRAL)).toEqual({
      stopAll: false,
      suppressPlucks: false,
      muted: false,
    });
  });

  it("unknown shape values behave as neutral", () => {
    expect(strumGestureAction(SHAPE_NEUTRAL, 99)).toEqual(
      strumGestureAction(SHAPE_NEUTRAL, SHAPE_NEUTRAL),
    );
  });
});

describe("modeLabel", () => {
  it("adds the right-hand modifier", () => {
    expect(modeLabel("Chord", SHAPE_NEUTRAL)).toBe("Chord");
    expect(modeLabel("Power", SHAPE_OPEN_PALM)).toBe("Power · palm mute");
    expect(modeLabel("Chord", SHAPE_FIST)).toBe("Chord · stop");
    expect(modeLabel("Power", 42)).toBe("Power");
  });
});
