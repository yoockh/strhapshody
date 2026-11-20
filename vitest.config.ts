import { defineConfig } from "vitest/config";

/**
 * Vitest config (task 0.3).
 *
 * Unit tests for TS glue code live next to their sources as `*.test.ts`.
 * They run in the default node environment — the pure camera/mic-free logic
 * is in the Rust/WASM engine (tested with `cargo test`), so the TS side only
 * needs plain module tests here, not a DOM. A later phase can switch the
 * environment to `jsdom`/`happy-dom` if a test genuinely needs the DOM.
 *
 * The Playwright end-to-end suite (task 7.1) is a separate runner
 * (`npm run test:e2e`) and is intentionally excluded here. The standalone
 * WASM round-trip (`scripts/engine-roundtrip.ts`, ADR-0004) is also not a
 * vitest test, so `scripts/` is excluded too.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "engine", "scripts", "**/*.e2e.*"],
  },
});
