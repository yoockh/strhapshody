import { describe, expect, it } from "vitest";
import { helpSections } from "./help.ts";

const allText = (left: boolean) =>
  helpSections(left)
    .flatMap((s) => [s.title, ...s.items.map((i) => i.text)])
    .join("\n");

describe("helpSections", () => {
  it("covers position, chord hand, strum hand and tips", () => {
    const titles = helpSections().map((s) => s.title);
    expect(titles[0]).toBe("Get in position");
    expect(titles[1]).toBe("Left hand — pick the chord");
    expect(titles[2]).toBe("Right hand — strum");
    expect(titles).toHaveLength(4);
  });
  it("swaps the hands for left-handed players", () => {
    const titles = helpSections(true).map((s) => s.title);
    expect(titles[1]).toBe("Right hand — pick the chord");
    expect(titles[2]).toBe("Left hand — strum");
    expect(allText(true)).toContain("your right hand plays the right side");
  });
  it("explains the finger counts, palm-mute pitfall and the strum rule", () => {
    const t = allText(false);
    expect(t).toMatch(/Index finger up = major/);
    expect(t).toMatch(/Index \+ middle up = minor/);
    expect(t).toMatch(/fully open flat palm means palm mute/);
    expect(t).toMatch(/next strum/);
    expect(t).toMatch(/both must be in the picture/);
  });
  it("every item has an icon and text", () => {
    for (const s of helpSections()) {
      for (const i of s.items) {
        expect(i.icon.length).toBeGreaterThan(0);
        expect(i.text.length).toBeGreaterThan(10);
      }
    }
  });
});
