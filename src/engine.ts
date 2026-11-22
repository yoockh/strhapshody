/**
 * Frontend entry point to the Rust/WASM engine (ADR-0002 / ADR-0004).
 *
 * The engine is built with `wasm-pack --target web` (see ADR-0004): its default
 * export is an async initializer that must run once, before any exported class
 * or function is used, to instantiate the wasm module. In the browser the
 * initializer fetches `engine_bg.wasm` relative to the module URL (Vite serves
 * it as an asset). This module wraps that one-time init in an idempotent
 * promise and re-exports the pieces the frontend needs so callers don't each
 * re-implement the init dance.
 *
 * Not unit-tested: it needs the wasm runtime, which vitest's node env doesn't
 * load (the engine's own logic is covered by `cargo test`; the full
 * browser+wasm path is exercised by the Playwright e2e suite, task 7.1).
 */

import init, {
  StrumDetector,
  HexMap,
  OneEuroFilter,
  FingerCountDetector,
  ChordLatch,
} from "../engine/pkg/engine.js";
export { StrumDetector } from "../engine/pkg/engine.js";
export { StrumDirection } from "../engine/pkg/engine.js";
export type { StrumEvent } from "../engine/pkg/engine.js";
export { HexMap, OneEuroFilter } from "../engine/pkg/engine.js";
export {
  FingerCountDetector,
  ChordLatch,
  ChordQuality,
} from "../engine/pkg/engine.js";

let ready: Promise<void> | null = null;

/**
 * Initialize the WASM engine exactly once. Subsequent calls return the same
 * in-flight / resolved promise. Resolves when the engine's exports are safe to
 * construct and call.
 */
export function initEngine(): Promise<void> {
  if (!ready) {
    ready = init().then(() => undefined);
  }
  return ready;
}

/** Re-export so callers get the type without reaching into engine/pkg. */
export type StrumDetectorInstance = InstanceType<typeof StrumDetector>;
export type HexMapInstance = InstanceType<typeof HexMap>;
export type OneEuroFilterInstance = InstanceType<typeof OneEuroFilter>;
export type FingerCountDetectorInstance = InstanceType<typeof FingerCountDetector>;
export type ChordLatchInstance = InstanceType<typeof ChordLatch>;
