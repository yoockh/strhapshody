/**
 * Task 0.2 — WASM pipeline round-trip from TypeScript.
 *
 * Proves the full chain works end to end: Rust source -> `wasm-pack build`
 * (web target, in engine/pkg) -> import into TypeScript -> call across the
 * JS/WASM boundary and get the right values back.
 *
 * Run with: `npm run roundtrip:engine` (builds the engine first).
 * Node runs this .ts file directly via type-stripping (Node >= 22).
 *
 * This is a standalone node:assert script, not a vitest test, on purpose:
 * the vitest harness is wired in task 0.3. Keeping 0.2 self-contained lets the
 * pipeline be verified before the frontend test runner exists.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

// The web-target pkg is a browser-oriented ES module: it needs the wasm bytes
// handed to it explicitly. In the browser the frontend fetches them; here in
// Node we read the file and use the synchronous initializer.
import { initSync, add, engine_version } from "../engine/pkg/engine.js";

const wasmPath = fileURLToPath(
  new URL("../engine/pkg/engine_bg.wasm", import.meta.url),
);
initSync({ module: readFileSync(wasmPath) });

// Primitive round-trip.
assert.equal(add(2, 3), 5, "add(2, 3) should cross the boundary as 5");
assert.equal(add(-4, 4), 0, "add(-4, 4) should cross the boundary as 0");

// String (heap-allocated) round-trip.
assert.equal(
  engine_version(),
  "0.1.0",
  "engine_version() should round-trip the crate version string",
);

console.log(
  `✅ engine WASM round-trip OK — add(2,3)=${add(2, 3)}, engine_version()="${engine_version()}"`,
);
