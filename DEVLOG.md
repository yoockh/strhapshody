# DEVLOG

Append-only running log, newest entry at the bottom. One entry per work session. Format:

```
## YYYY-MM-DD HH:MM WIB — session summary
- did: ...
- tested: ...
- next: ...
- needs human verification: ... (only if applicable)
```

---

## 2026-11-20 21:30 WIB — project setup (orchestrator session, not a build session)

- did: paused all 5 standing crons per Yaya's request (focus limit on this project until done);
  cloned empty `strhapshody` repo to `~/Documents/projects/strhapshody`; wrote `docs/PRD.md`,
  `CLAUDE.md`, `TASKS.md`, `DECISIONS.md` (ADR-0001/0002/0003), this file, and `TESTING.md`;
  checked environment: no cargo/rustc, no passwordless sudo, no webkit2gtk-4.1 (blocks Tauri),
  node/npm already present; started `rustup` install in background (no sudo needed, user-local).
- tested: n/a, planning-only session.
- next: verify rustup finished, scaffold Vite+TS app (task 0.1) and `engine/` Rust crate with
  wasm-pack (task 0.2), get the WASM round-trip proven, then hand off to a long-running Claude
  Code CLI session to work through `TASKS.md` phase by phase.
- needs human verification: none yet (nothing built).

## 2026-11-20 22:40 WIB — task 0.1 Vite + TypeScript scaffold

- did: confirmed rustup/cargo/wasm-pack finished installing (all present in ~/.cargo/bin).
  Scaffolded the frontend web app (ADR-0001): `package.json` (vite ^6 + typescript ^5, scripts
  dev/build/preview/typecheck), `tsconfig.json` (strict, bundler resolution), `index.html` with
  a single full-viewport `#stage` canvas, and `src/`: `style.css`, `main.ts` (rAF render loop),
  `stage.ts` (DPR-aware canvas sizing + `withMirroredFeed` horizontal-flip helper), and
  `placeholder.ts` (static test pattern: colour bars + a top-left corner wedge drawn inside the
  mirrored layer so the flip is visible, plus an un-mirrored zone divider and LEFT/RIGHT labels
  per PRD §5). Added `src/vite-env.d.ts` for the CSS import type, and `.gitignore`
  (node_modules, dist, *.log, engine build dirs for 0.2).
- tested: `npm run build` (tsc + vite build) passes clean; dev server (`npm run dev`) starts,
  serves `/` 200 and transforms the TS modules over HTTP. No `cargo test` / `npm run test` yet —
  the Rust engine is task 0.2 and the vitest harness is task 0.3; task 0.1 has no camera-free
  pure logic to unit-test (canvas rendering is DOM-bound), so nothing was faked green.
- next: task 0.2 — scaffold the Rust `engine/` crate, wasm-pack build config, a trivial exported
  function with a TS round-trip test proving the WASM pipeline, and a dummy `cargo test`.
- needs human verification: visual look of the placeholder/mirroring in a real browser window is
  best eyeballed by a human, but it is correct by construction (build + dev-server probes green).

Note for next session: `npm install` warned that esbuild's postinstall script was blocked by
npm 12's allowScripts gate — harmless here, vite 6 resolves the esbuild platform binary via
optionalDependencies and both build and dev server work. If a future esbuild error appears, run
`npm install-scripts approve esbuild` (or equivalent) to unblock it.
