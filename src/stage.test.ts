import { describe, expect, it } from "vitest";
import { createStage } from "./stage.ts";

/**
 * First TS-glue unit test (task 0.3). Its job is twofold:
 *  1. Prove the vitest harness runs and resolves `.ts` ESM imports of app
 *     source — i.e. `npm run test` is really wired up.
 *  2. Exercise one genuinely camera/mic-free branch of real app code so this
 *     is not a vacuous `expect(1).toBe(1)` smoke test: the guard in
 *     `createStage` that fails fast when a 2D context is unavailable.
 *
 * The happy path of `createStage` touches `window`/DOM resize APIs and is
 * covered end-to-end by the Playwright suite (task 7.1), not here.
 */
describe("createStage", () => {
  it("throws a clear error when the 2D context is unavailable", () => {
    const fakeCanvas = {
      getContext: () => null,
    } as unknown as HTMLCanvasElement;

    expect(() => createStage(fakeCanvas)).toThrow(
      "2D canvas context unavailable",
    );
  });
});
