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

## 2026-11-20 23:05 WIB — task 0.2 Rust engine crate + WASM round-trip

- did: scaffolded the `engine/` Rust crate (ADR-0002/0004): `engine/Cargo.toml`
  (`crate-type = ["cdylib", "rlib"]` so the same source both compiles to wasm and runs under
  native `cargo test`; `wasm-bindgen = "0.2"`; release profile `opt-level="s"` + lto for small
  browser wasm) and `engine/src/lib.rs` with two trivial `#[wasm_bindgen]` exports — `add(i32,i32)`
  (primitive round-trip) and `engine_version()->String` (heap/String round-trip) — each with a
  native unit test. Added `npm run build:engine` (`wasm-pack build engine --target web --out-dir
  pkg`) and `npm run roundtrip:engine`, plus `scripts/engine-roundtrip.ts`, a standalone
  `node:assert` script that imports `engine/pkg/engine.js`, inits the wasm from disk bytes via
  `initSync`, and asserts the exported functions return correct values across the JS/WASM boundary.
  Recorded the target/test-style choice as ADR-0004. `engine/pkg/` + `engine/target/` already
  gitignored (from 0.1); `engine/Cargo.lock` committed for reproducible builds.
- tested: `cd engine && cargo test` → 2 passed, 0 failed (plus 0 doctests). `npm run
  roundtrip:engine` → builds the wasm then prints "✅ engine WASM round-trip OK — add(2,3)=5,
  engine_version()=\"0.1.0\"", proving the Rust→wasm-pack→TS pipeline end to end. `npm run
  typecheck` still exits 0 (frontend untouched). No faked passes.
- next: task 0.3 — wire `npm run test` (vitest) and document both suites; add a `test:all` script
  running `cargo test` + `npm run test` (and fold the engine round-trip into the test flow).
- needs human verification: none (pure logic + build-tool pipeline, fully machine-verifiable).
  Note: `wasm-pack` must be on PATH (it is, via `~/.cargo/bin`); `build:engine` assumes this.

Note for next session: `npm install` warned that esbuild's postinstall script was blocked by
npm 12's allowScripts gate — harmless here, vite 6 resolves the esbuild platform binary via
optionalDependencies and both build and dev server work. If a future esbuild error appears, run
`npm install-scripts approve esbuild` (or equivalent) to unblock it.

## 2026-11-20 21:46 WIB — task 0.3 test tooling (vitest + cargo + test:all)

- did: installed `vitest` (^5.1.1) as a dev dependency and wired up the TS test harness
  (ADR-0004's round-trip stays a standalone script, unchanged). Added `vitest.config.ts`
  (node env, `include: src/**/*.test.ts`, excludes `engine`/`scripts`/e2e so the WASM
  round-trip and the future Playwright suite don't get swept in). Added `package.json`
  scripts: `test` (`vitest run`), `test:watch`, `test:engine` (`cd engine && cargo test`), and
  `test:all` (engine then vitest). Wrote the first TS-glue unit test `src/stage.test.ts` — it
  proves the harness resolves `.ts` ESM imports of app source AND exercises a real camera-free
  branch (the `createStage` guard that throws when the 2D context is unavailable), so it isn't
  a vacuous smoke test. `TESTING.md` already documented both suites + `test:all`; it's now
  accurate rather than aspirational.
- tested: `npm run test` → 1 file / 1 test passed. `npm run test:all` → cargo test 2 passed +
  0 failed (and 0 doctests), then vitest 1 passed. `npm run typecheck` → exit 0 (tsc now also
  typechecks the new `*.test.ts` under `src/`, resolves `vitest` types fine). `npm run build`
  → clean (test file is not pulled into the `index.html` entry bundle). No faked passes.
- next: task 0.4 — real webcam capture via `getUserMedia`, mirrored on the canvas (replacing
  the placeholder feed layer), with a graceful error path when camera permission is denied.
- needs human verification: none (pure tooling + a logic-branch test, fully machine-verifiable).
  Note: `npm install` again warned esbuild's postinstall was blocked by npm 12's allowScripts
  gate — same harmless case as 0.2; vitest ran fine. The `test:e2e` command named in
  `TESTING.md` is still a forward reference (Playwright script lands in task 7.1).

## 2026-11-20 21:50 WIB — task 0.4 real webcam capture (getUserMedia, mirrored, graceful error)

- did: wired up live camera capture replacing the static placeholder feed. New `src/webcam.ts`:
  `startWebcam()` requests `getUserMedia` (720p ideal, front camera, audio off), drives a hidden
  `<video>`, waits for real frame dimensions (loadedmetadata), and exposes `stop()` (releases all
  tracks, idempotent); `describeCameraError()` maps DOMException names (NotAllowedError,
  NotFoundError, NotReadableError, Overconstrained, Abort, legacy aliases) to short actionable
  sentences, falling back to the error message then a generic catch-all. New `src/videoframe.ts`:
  pure `computeCoverCrop()` (aspect-correct "cover" fit — fill canvas, crop overflow, centred, no
  stretch/letterbox) + thin DOM `drawVideoCover()` wrapper. `src/placeholder.ts`: `drawZoneOverlay`
  now takes an optional caption (so a real feed isn't captioned "placeholder") and added
  `drawErrorBanner` (centred, word-wrapped red panel for the no-camera path). `src/main.ts` now
  has three render states — starting (placeholder + "starting camera…"), live (mirrored video via
  withMirroredFeed), failed (placeholder + error banner) — and stops the camera on beforeunload.
- tested: `npm run typecheck` exit 0; `npm run test` → 3 files / 16 tests pass (added
  `src/webcam.test.ts` covering every error branch incl. non-object/null throws, and
  `src/videoframe.test.ts` covering cover-fit math incl. portrait-canvas and degenerate-zero
  cases); `npm run build` clean (8 modules); `npm run test:engine` → cargo 2 passed/0 failed. No
  faked passes. The async getUserMedia path + actual video→canvas blit are DOM/camera-bound and
  are deferred to the Playwright e2e suite (task 7.1) with a fake media device, per TESTING.md.
- next: task 1.1 — integrate `@mediapipe/tasks-vision` HandLandmarker and draw both hands'
  landmarks as an overlay on the canvas.
- needs human verification: the live mirrored feed, "cover" framing, and the permission-denied
  banner all need a real webcam + a real allow/deny prompt to eyeball — correct by construction
  (pure logic unit-tested, build + typecheck green) but not visually confirmed without a camera.
  Belongs on the Phase 7.3 manual checklist for Yaya.

## 2026-11-20 21:55 WIB — task 1.1 MediaPipe HandLandmarker + landmark overlay

- did: installed `@mediapipe/tasks-vision@0.10.35` (npm install succeeded fast this time despite
  the slow-link worry; esbuild postinstall still blocked by npm 12 allowScripts — harmless, same
  as prior sessions). Integrated HandLandmarker following the ADR-0002 testability split:
  * `src/handtracking.ts` — thin WASM/browser wrapper: `createHandTracker()` loads the vision
    fileset (jsDelivr, version-pinned) + hand model (Google storage) and configures VIDEO mode,
    numHands=2; `detect(video, ts)` guards against non-increasing timestamps (MediaPipe VIDEO
    requirement) and zero-dim frames, returning null instead of throwing; `close()` idempotent.
    NOT unit-tested (needs WASM + camera) — deferred to e2e/human, per ADR-0002.
  * `src/handoverlay.ts` — PURE, unit-tested: `HAND_CONNECTIONS` (canonical 21-point hand
    skeleton, defined locally so the module stays WASM-free), `landmarkToCanvas()` mapping a
    normalized landmark through the SAME cover-crop (`computeCoverCrop`) + horizontal mirror used
    to blit the feed, so dots land on the hand in the mirrored image; plus the thin DOM
    `drawHandLandmarks()` wrapper (bones then joints).
  * `src/main.ts` — creates the tracker in the background after the camera is live (failure just
    skips the overlay, never breaks the render loop or the feed), runs detection per frame with
    `performance.now()` timestamps, caches the last result, and draws the un-mirrored overlay
    (mirror is baked into the coords). Closes the tracker on beforeunload.
  Recorded the CDN-vs-vendor asset choice as ADR-0005.
- tested: `npm run typecheck` exit 0; `npm run test` → 4 files / 24 tests pass (added
  `src/handoverlay.test.ts`: 8 tests covering connection-index validity, skeleton connectivity
  via BFS from the wrist, centre→centre mapping, mirror reflection, cover-crop consistency on a
  portrait canvas, off-canvas cropped landmarks not clamped, and degenerate-dim → origin guards);
  `npm run build` clean (11 modules, 133 kB / 41 kB gzip); `npm run test:engine` → cargo 2
  passed/0 failed. No faked passes.
- next: task 1.2 — handedness assignment (MediaPipe handedness + screen-side fallback per PRD
  §13), left/right zone split rendered, status bar skeleton.
- needs human verification: real HandLandmarker tracking accuracy and whether the drawn skeleton
  actually lands on the hand (incl. the mirror being the right way round) need a real webcam +
  real hands — the coordinate math is unit-tested and correct by construction, but MediaPipe
  inference + the live blit can't run in this camera-less env. Also: the CDN wasm/model fetch
  (ADR-0005) needs a real online browser to confirm it loads. Both belong on the Phase 7.3 manual
  checklist, and the full pipeline gets a deterministic exercise in the Playwright suite (7.1).

## 2026-11-20 22:05 WIB — task 1.2 handedness assignment + zone split + status bar skeleton

- did: implemented left/right hand role assignment and the HUD skeleton, keeping the testable
  logic pure (ADR-0002 / handoverlay.ts precedent) and the DOM drawing thin:
  * `src/handedness.ts` — PURE, unit-tested: `assignHands()` maps detected hands to the chord
    (left zone) and strum (right zone) roles per PRD §5/§13. PRIMARY signal is MediaPipe
    handedness; because we feed RAW unmirrored frames to MediaPipe while the display is mirrored,
    the labels are swapped to recover the user's real hand (`DEFAULT_HANDEDNESS_ROLE`: MediaPipe
    "Right"→chord, "Left"→strum — one constant to flip if it's backwards on real hardware).
    BACKUP signal is screen-side position (leftmost hand → chord), used whenever handedness is
    unreliable: a label below `minScore` (default 0.6) or both hands reporting the same label
    (the hands-crossed failure mode). Guarantees two hands never collapse into the same role.
    Also `representativeX()` (palm-centre x from wrist+middle-MCP) and `roleIsTracked()`.
  * `src/hud.ts` — `trackingSummary()` (PURE, unit-tested: assignments → per-role flags + a
    one-line health label) plus thin DOM `drawZoneSplit()` (cool/warm zone tints + an accent
    highlight on whichever zone currently has a tracked hand) and `drawStatusBar()` (top bar with
    CHORD / MODE / INSTRUMENT / TRACKING fields).
  * `src/main.ts` — adapts each MediaPipe result into pure `RawHand[]` (`toRawHands`), runs
    `assignHands` per frame, highlights the active zone(s), and renders the status bar. Chord
    ("—") and instrument ("Acoustic") are placeholders for Phases 3/5; mode is "Chord"; tracking
    health is live (camera off / starting / loading tracker / no hands / left only / right only /
    both hands).
- tested: `npm run typecheck` exit 0; `npm run test` → 6 files / 42 tests pass (+18: 14 in
  `handedness.test.ts` covering nominal handedness assignment, same-label and low-confidence
  screen-side fallback, single-hand both paths, mirror/roleMap/minScore options, and the no-role
  collapse guarantee; 4 in `hud.test.ts` covering every tracking-health label); `npm run build`
  clean (13 modules, 136 kB / 43 kB gzip); `npm run test:engine` → cargo 2 passed / 0 failed. No
  faked passes.
- next: task 1.3 — One Euro filter smoothing as a Rust/WASM `smoothing` module with `cargo test`
  over synthetic jittery input sequences (first real engine logic module).
- needs human verification: the MediaPipe→user-hand mirror swap in `DEFAULT_HANDEDNESS_ROLE`
  can't be confirmed without a real camera + real hands — if the chord/strum zones feel swapped,
  flip that one constant (the screen-side backup is already correct by construction and matches
  §5). Also the look of the zone tints, active-zone highlight, and status bar needs a real
  browser eyeball. Both belong on the Phase 7.3 manual checklist; the pipeline gets a
  deterministic exercise in the Playwright suite (7.1).

## 2026-11-20 22:15 WIB — task 1.3 One Euro filter smoothing (Rust/WASM `smoothing` module)

- did: implemented the first real engine logic module, `engine/src/smoothing.rs` — the One Euro
  adaptive low-pass filter (Casiez et al., CHI 2012) for the jittery hand-landmark signal. Split
  into a private `LowPass` (single exponential smoother, first sample passes through to seed),
  `smoothing_alpha(cutoff, te)` helper, a pure wasm-free core `OneEuro` (new/filter/reset), and a
  thin `#[wasm_bindgen] OneEuroFilter` wrapper. Design + contract recorded as ADR-0006: one filter
  instance per scalar stream (frontend makes one per coordinate), timestamps in **seconds**,
  non-decreasing with a nominal-60 Hz fallback so a non-advancing/first/backwards timestamp can't
  divide by zero, and sanitization of non-finite samples + non-positive/NaN config so live garbage
  never yields NaN output. Exported from `lib.rs` via `pub mod smoothing` + `pub use`.
- tested: `cd engine && cargo test` → 12 passed / 0 failed (was 2; +10 smoothing tests):
  first-sample pass-through, constant-signal convergence, **variance cut to <25% of raw** on a
  synthetic xorshift-jitter stream (the "noise reduction" proof), **bounded steady-state lag on a
  ramp** and **higher-beta-lags-less on fast motion** (the "without excessive lag" proof), plus
  edge cases: non-increasing timestamp (no div-by-zero), non-finite sample ignored + recovery,
  bad-config sanitization, reset re-seeding, and alpha-in-(0,1]. `npm run build:engine` → wasm
  compiles clean and `engine/pkg/engine.d.ts` now exports `class OneEuroFilter`. `npm run test`
  → 6 files / 42 tests still pass (frontend untouched). No faked passes.
- next: task 2.1 — render six virtual string lines in the right (strum) zone.
- needs human verification: the *feel* of the chosen default filter params (how smooth vs. laggy
  the cursor feels in the hand) can only be judged with a real camera + hands; min_cutoff/beta are
  correct by construction and provably reduce noise without runaway lag in unit tests, but the
  tuning sweet spot is a Phase 6.2 sensitivity-slider + Phase 7.3 manual-checklist item. The filter
  isn't wired into the live render loop yet (no UI task consumes it until the cursor work).

## 2026-11-21 19:40 WIB — task 2.1 six virtual string lines in the right (strum) zone

- did: rendered the six virtual guitar strings across the right zone (PRD §8), following the
  ADR-0002 pure-logic/thin-DOM split. New `src/strings.ts`:
  * PURE, unit-tested: `computeStringYs(top, bottom, count=6, marginFraction=0.12)` — evenly
    spaced, top-to-bottom y positions inset from the band edges, with guards so a degenerate
    zero-height band, an absurd margin fraction (clamped <0.5 so the inner band can't invert), or
    a fractional/zero/negative count never produce NaN or <1 line; `stringWidth(index, …)` — a
    gauge taper from thickest at the top (index 0 = low E, so a downstroke sounds top→bottom per
    §8) to thinnest at the bottom (high E). Plus `STRING_COUNT=6` and `STRING_NOTE_NAMES`
    (E A D G B e, standard tuning, 6th→1st top→bottom) for later phases.
  * thin DOM `drawStrings()` — strokes the six lines with a small horizontal inset and the gauge
    taper; not unit-tested (needs a real 2D context), exercised by e2e (7.1) / a human.
  * `src/hud.ts` — extracted `statusBarHeight(height)` (the existing `max(36, round(h*0.07))`
    formula) and reused it inside `drawStatusBar`, so the strum-zone top stays DRY.
  * `src/main.ts` — draws the strings in the right half (`width/2 .. width`) below the status bar
    each frame, behind the hand skeleton and status bar.
- tested: `npm run test` → 7 files / 53 tests pass (+11 in `src/strings.test.ts`: default six
  lines, strictly-ascending order, within-band + margin bounds, even/symmetric spacing, single
  centred line, zero-height band, clamped margin, floored/min count; plus gauge taper direction,
  endpoints, and single-string width). `npm run typecheck` exit 0; `npm run build` clean (14
  modules, 137 kB / 43 kB gzip); `npm run test:engine` → cargo 12 passed / 0 failed. No faked
  passes.
- next: task 2.2 — Rust/WASM `strum` module: line-crossing detection, direction (up/down), and
  velocity from a landmark trajectory, with synthetic up/down/slow/fast + near-miss/double-cross
  `cargo test` cases.
- needs human verification: the look/placement of the six lines in the right zone (spacing,
  gauge taper, that they sit below the status bar and read as strings) needs a real browser
  eyeball — correct by construction (geometry unit-tested, build + typecheck green) but not
  visually confirmed in this camera-less env. Belongs on the Phase 7.3 manual checklist; the
  render path gets a deterministic exercise in the Playwright suite (7.1).

## 2026-11-21 19:42 WIB — task 2.2 Rust/WASM `strum` module (crossing/direction/velocity)

- did: implemented the strum detector `engine/src/strum.rs` (PRD §8), the first right-hand logic
  module, following the ADR-0002/0006 pure-core + thin-wasm-wrapper split. Pure `StrumCore` holds
  all tested logic; `#[wasm_bindgen] StrumDetector` wraps it. `.push(y, timestamp)` is fed one
  hand-point sample at a time and returns the string crossings for *that step* as a
  `Vec<StrumEvent>` ({ string_index, direction: StrumDirection{Down,Up}, velocity px/s }) in rake
  order — top→bottom on a downstroke, bottom→top on an upstroke — so the audio layer (2.4) can
  trigger voices directly. Crossing uses a **half-open** interval (down: `prev < s <= y`; up:
  `y <= s < prev`) so resting on / leaving a line never re-fires it and a near-miss fires nothing;
  velocity = |Δy|/Δt with a nominal-60 Hz fallback so it's always finite and ≥ 0; string positions
  sorted ascending + NaNs dropped at construction so `string_index` is stable (0 = topmost = low E
  per strings.ts) regardless of caller order. `.reset()` re-seeds the reference point when tracking
  is lost / the hand leaves the zone (prevents a phantom whole-fretboard strum on a jump). Recorded
  the event-stream + crossing-convention + Vec<StrumEvent> boundary choice as ADR-0007. Exported
  from lib.rs via `pub mod strum` + `pub use`.
- tested: `cd engine && cargo test` → 28 passed / 0 failed (was 12; +16 strum tests): first-sample
  no-fire, full down/up sweep in correct rake order, partial stroke, two near-miss cases (approach
  without crossing, wobble between lines), double-cross in one frame, land-on-line-then-rest no
  re-fire, down-then-up each direction once, slow-vs-fast velocity (exact 1000 vs 6000 px/s),
  velocity finite/non-negative + duplicate-timestamp nominal fallback, backwards-timestamp still
  detects + stays finite, non-finite sample ignored with state preserved, reset swallows the jump,
  unsorted/NaN string input normalized, no-strings-configured never fires. `npm run build:engine`
  → wasm compiles clean; `engine/pkg/engine.d.ts` now exports `class StrumDetector` with
  `push(y, timestamp): StrumEvent[]` + `StrumEvent`/`StrumDirection` (Vec<StrumEvent> return
  marshals fine on wasm-bindgen 0.2.130). `npm run test` → 7 files / 53 tests still pass (frontend
  untouched); `npm run typecheck` exit 0; no faked passes.
- next: task 2.3 — palm-mute (open flat palm) + fist-stop (closed fist) gesture detection from
  landmark geometry, with synthetic hand-shape landmark unit tests.
- needs human verification: none for this module — pure deterministic logic, fully cargo-tested.
  The detector isn't wired into the live render loop yet (task 2.4 consumes its events for audio;
  the hand-point source + the smoothing/reset wiring land with the audio/cursor work). Real strum
  *feel* (does a natural hand sweep fire the strings cleanly, missed-strum rate <5% per PRD §10)
  needs a real camera + hands and belongs on the Phase 7.3 manual checklist.

## 2026-11-21 19:48 WIB — task 2.3 palm-mute / fist-stop gesture detection (Rust/WASM `gesture`)

- did: implemented the right-hand shape classifier `engine/src/gesture.rs` (PRD §8), the first
  engine module to consume a whole hand's 21 MediaPipe landmarks. Follows the ADR-0002 pure-core
  + thin-wasm-wrapper pattern. A hand crosses the boundary as a flat `&[f64]` of 42 interleaved
  `x, y` values (a `Float64Array`); only image-plane x,y are used. Each finger (index/middle/ring/
  pinky; thumb intentionally excluded) is judged by a **straightness ratio** `dist(MCP,TIP) /
  (seg MCP-PIP + PIP-DIP + DIP-TIP)` — ~1 straight, →0 curled — which is translation/scale/
  rotation invariant so no hand-size calibration is needed. Extended at ratio ≥ 0.80, curled at
  ≤ 0.60, dead zone between so a half-open hand is `Neutral`. `classify_shape` → `HandShape`
  {Neutral, OpenPalm (all four extended → palm mute), Fist (all four curled → stop)}; wrong-length
  / non-finite input → Neutral, never panics. Wrapped in a stateful `GestureCore`/`GestureDetector`
  with a debounce (`hold_frames` default 3) + `reset()`, matching the strum/smoothing stateful-
  detector pattern. Exported from lib.rs: `GestureDetector`, `HandShape`, free fn `classifyHandShape`.
  Recorded the landmark-array boundary convention + straightness metric + thresholds as ADR-0008.
- tested: `cd engine && cargo test` → 43 passed / 0 failed (was 28; +15 gesture tests): straight-
  finger ratio ~1, curled-finger ratio < 0.60, open-palm = all extended, fist = all curled, three
  partial-hand Neutral cases, wrong-length Neutral, non-finite Neutral, degenerate coincident-joint
  no-crash Neutral, a rotate+scale+translate invariance test on a fist, and debounce behaviour
  (needs hold_frames to commit, rejects a single noisy frame, switches on sustained change,
  hold_frames=0→1 immediate, reset→Neutral, lost-hand decays to Neutral). `npm run build:engine`
  → wasm compiles clean; `engine/pkg/engine.d.ts` now exports `class GestureDetector`,
  `enum HandShape`, and `function classifyHandShape(...)`. `npm run test` → 7 files / 53 tests still
  pass (frontend untouched); `npm run typecheck` exit 0. No faked passes.
- next: task 2.4 — Web Audio engine skeleton: 6 string voices, a single hardcoded test chord,
  pluck synthesis wired to the strum events from 2.2 (placeholder timbre fine until Phase 5). The
  gesture detector gets wired in there too (palm-mute shortens/dulls, fist silences), with
  `.reset()` on right-hand tracking loss.
- needs human verification: none for the pure logic (fully cargo-tested, deterministic). The real
  *feel* — whether a natural flat palm reliably reads as OpenPalm and a real fist as Fist on live
  MediaPipe landmarks, the right thresholds/hold_frames, and whether excluding the thumb is correct
  in practice — needs a real camera + hands; belongs on the Phase 6.2 tuning + Phase 7.3 manual
  checklist. The detector isn't in the live render loop yet (2.4 consumes it for audio).

## 2026-11-21 20:05 WIB — task 2.4 Web Audio engine skeleton (6 voices, test chord, strum→pluck)

- did: built the Web Audio skeleton (PRD §9) and, for the first time, wired the browser frontend
  into the WASM engine (the `strum` detector from 2.2). Following the ADR-0002 pure/DOM split,
  recorded as ADR-0009:
  * `src/notes.ts` — PURE, unit-tested: scientific-pitch-notation parsing (`noteToMidi`/
    `noteToFrequency`, sharps/flats + `s` alias, case-insensitive, negative octaves, rejects
    garbage) and equal-temperament `midiToFrequency` (A4=440). `TEST_CHORD_NOTES` = the six open
    strings E2 A2 D3 G3 B3 E4 (matches `STRING_NOTE_NAMES` top→bottom) + resolved
    `TEST_CHORD_FREQUENCIES`.
  * `src/audio.ts` — PURE `velocityToGain` (strum px/s → voice gain in [0.08,1.0], linear to a
    3000 px/s ref then saturating, non-finite/≤0 → floor, never NaN; unit-tested) + the thin
    `createAudioEngine` Web Audio wrapper (NOT unit-tested — needs a live AudioContext): 6 voice
    slots, triangle-osc placeholder pluck with fast attack + ~1.4 s exp decay on a master bus,
    `resume()`/`setChord()`/`pluck()`/`stopAll()`/`close()`. Defaults to the test chord. No
    Web-Audio symbol touched at import time, so node can import it for the pure test.
  * `src/engine.ts` — idempotent `initEngine()` wrapping the `wasm-pack --target web` default
    async initializer (ADR-0004's anticipated frontend init), re-exporting `StrumDetector`/
    `StrumEvent`/`StrumDirection`.
  * `src/main.ts` — inits the engine + audio in the background; resumes audio on the first
    pointer/key gesture (autoplay policy); `processStrum()` (re)builds a `StrumDetector` on
    strum-zone geometry change, feeds it the strum hand's palm-centre y via the same
    `landmarkToCanvas` transform as the overlay (so crossings line up with the drawn strings),
    plucks a voice per `StrumEvent` (then `.free()`s each event), and `.reset()`s the detector
    whenever the strum hand is absent (avoids the ADR-0007 whole-zone-strum-on-reentry hazard).
    Cleans up audio + detector on beforeunload.
- tested: `npm run typecheck` exit 0; `npm run test` → 9 files / 73 tests pass (+20: 14 in
  `notes.test.ts` covering MIDI/frequency math, SPN parsing incl. sharps/flats/`s`-alias/case/
  negative-octave/whitespace, every reject case, and the open-string test chord; 6 in
  `audio.test.ts` covering `velocityToGain` floor/saturation/linearity/monotonicity/bounds/custom
  opts); `npm run build` → clean, and crucially Vite now bundles the engine wasm
  (`dist/assets/engine_bg-*.wasm`, 31.55 kB) — the frontend→WASM pipeline works at build time;
  `npm run test:engine` → cargo 43 passed / 0 failed (engine untouched). No faked passes.
- next: task 3.1 — Rust/WASM `hexmap` module: circle-of-fifths hex layout math, point-in-hex test,
  hysteresis at borders, with `cargo test` over center/ring/border-flicker cases.
- needs human verification: the actual *sound* can't be produced in this headless, audio-less env
  — whether a strum fires audible plucks at the right pitches, the placeholder timbre, the
  velocity→loudness feel, and that the palm-y→string-crossing mapping lines up on a real camera all
  need Yaya's machine + hands + speakers. The strum→pluck pipeline is correct by construction (pure
  parts unit-tested, engine cargo-tested, build green) and gets a deterministic end-to-end exercise
  via the Playwright keyboard-fallback + Web-Audio-assertion suite in task 7.1. Belongs on the
  Phase 7.3 manual checklist. Also: this is the first real browser load of the engine wasm — the
  `initEngine()` fetch needs a real online browser to confirm (ADR-0004/0005 CDN+asset caveat).

## 2026-11-21 20:00 WIB — task 3.1 Rust/WASM `hexmap` module (layout + point-in-hex + hysteresis)

- did: implemented the chord-map geometry engine module `engine/src/hexmap.rs` (PRD §6.1), the
  first left-hand logic module, following the ADR-0002 pure-core + thin-wasm-wrapper pattern.
  Pure `HexCore` holds all tested logic; `#[wasm_bindgen] HexMap` wraps it. The 7-cell flower is
  **flat-top** hexagons (only orientation with a neighbour directly above, so G can sit at the top
  of the ring); cell index order fixed `[C, G, D, A, E, B, F]` — centre C, ring clockwise from top
  along the circle of fifths — with `CELL_CHORDS` exposed. Ring centres computed at √3·R from the
  flower centre at 60° steps clockwise from up (screen coords, y-down). `raw_cell(px,py)` is the
  stateless point-in-hex test: nearest centre (the hex tiling is the Voronoi of its centres) +
  exact flat-top containment (`|dy|≤√3/2·r` and `√3·|dx|+|dy|≤√3·r`) so a point just outside the
  flower reads as "no cell" instead of snapping to an outer hex. `update(px,py)` adds **border
  hysteresis**: holds the current cell while the cursor stays inside it inflated to `R+margin`, only
  adopts another cell once deep inside it (deflated to `R−margin`) or after leaving the inflated
  current cell — a √3·margin dead band so a cursor on a seam never flickers chords. Guards: radius
  floored positive, margin clamped `[0,0.49·R]`, non-finite config sanitised, a non-finite cursor
  sample keeps the held cell (one garbage frame can't drop the chord). `reset()` for tracking loss.
  `#[wasm_bindgen]` boundary: cell index as `i32` (`-1`=none, no Option shim) + `centerX/centerY/
  radius/cellCount/cellChord` getters for the 3.2 renderer. Recorded orientation + containment +
  hysteresis contract as ADR-0010. Exported from lib.rs via `pub mod hexmap` + `pub use HexMap`.
- tested: `cd engine && cargo test` → 59 passed / 0 failed (was 43; +16 hexmap tests): centres
  match the circle-of-fifths layout + all ring cells equidistant at √3·R, chord labels match spec,
  raw_cell hits every one of the 7 centres, centre-hex interior points, outside-flower → None (far
  above / to the side / just past an outer slanted edge), non-finite point → None, hysteresis holds
  then switches C→G and G→C at the computed inflate/deflate thresholds, **no-flicker oscillation on
  a border** (10 cycles straddling the seam stay on C), leaving the flower drops selection, reset
  clears, non-finite update keeps the held cell, adjacent ring-cell switch needs depth, degenerate
  radius guarded, absurd margin clamped, and the to_i32 none→-1 mapping. `npm run build:engine` →
  wasm compiles clean; `engine/pkg/engine.d.ts` now exports `class HexMap`. `npm run typecheck`
  exit 0; `npm run test` → 9 files / 73 tests still pass (frontend untouched); `npm run build`
  clean. No faked passes.
- next: task 3.2 — render the hex flower UI in the left zone, track the palm-centre cursor (via the
  cover-crop+mirror transform + One Euro smoothing from 1.3), and highlight the active hex using
  `HexMap.update()`.
- needs human verification: none for the pure logic (fully cargo-tested, deterministic). The *feel*
  of the default hysteresis `margin` and hex `radius` (does a steady hover hold one chord, does a
  deliberate move switch cleanly, chord-switch accuracy ≥95% per PRD §10) needs a real camera +
  hands and belongs on the Phase 6.2 tuning + Phase 7.3 manual checklist. The module isn't wired
  into the live render loop yet (task 3.2 consumes it for the cursor + highlight).

## 2026-11-21 20:10 WIB — task 3.2 hex chord-flower UI + palm cursor + active-hex highlight

- did: rendered the 7-cell hex chord flower in the left (chord) zone and wired the left hand's
  palm cursor into the WASM `hexmap` selector from 3.1 (PRD §6.1). Following the ADR-0002 split:
  * `src/hexflower.ts` — PURE, unit-tested geometry: `flatTopHexVertices(cx,cy,r)` (the 6 corners
    of one flat-top hexagon, matching the engine's containment math — top/bottom edges horizontal
    at ±√3/2·r; degenerate/non-finite r → 6 coincident centre points, never NaN) and
    `computeHexFlowerLayout(left,top,right,bottom,padding)` (centres the flower in the left-zone
    rectangle and picks the largest radius whose full `5R × 3√3R` bounding box still fits after a
    padding margin; padding clamped [0,0.49], degenerate rect → radius floored to 1). Plus the thin
    DOM `drawHexFlower()` (fills/strokes each cell, labels it with its chord letter, accents the
    active cell, dots the cursor) — not unit-tested (needs a 2D context), exercised by e2e/human.
  * `src/engine.ts` — re-export `HexMap` + `OneEuroFilter` (and their instance types) so the
    frontend reaches the 3.1/1.3 engine classes through the one init wrapper.
  * `src/main.ts` — new `processChord()`: (re)builds a `HexMap` sized to the left zone on geometry
    change, maps the chord hand's palm centre (wrist+middle-MCP mean) through the SAME cover-crop+
    mirror transform the overlay/strum point use, One-Euro-smooths x,y (ADR-0006, one filter each,
    seconds timestamps), feeds `HexMap.update()` for the hovered cell with hysteresis, draws the
    flower + cursor, and `.reset()`s the selector + both filters when the chord hand is absent (so a
    re-entering hand doesn't snap across the flower). The hovered chord letter now drives the status
    bar's CHORD field (was "—"). Freed the new wasm objects on beforeunload.
  No new ADR: ADR-0010 (hexmap contract) and ADR-0006 (One Euro contract) already govern this;
  the cursor smoothing params (min_cutoff 1.5, beta 0.01) and the 0.18·R hysteresis dead-band are
  feel-tuning those ADRs explicitly leave to Phase 6.2 sliders / the 7.3 manual checklist.
- tested: `npm run test` → 10 files / 85 tests pass (+12 in `src/hexflower.test.ts`: vertex count,
  all vertices on the circumradius, leftmost/rightmost on the centre line, flat-top edges at
  ±√3/2·r, centroid back to centre, degenerate-radius no-NaN; layout centring, bounding-box fit
  within the padded rect, width-bound vs height-bound zones, degenerate-rect radius floor, absurd-
  padding clamp). `npm run typecheck` exit 0; `npm run build:engine` → wasm rebuilt (HexMap +
  OneEuroFilter now in engine.d.ts); `npm run build` clean (19 modules, engine_bg wasm 36.29 kB
  bundled); `npm run test:engine` → cargo 59 passed / 0 failed (engine untouched). No faked passes.
- next: task 3.3 — finger-count gesture classification (index / index+middle / index+middle+ring)
  as a Rust/WASM function with synthetic extended/curled-finger unit tests.
- needs human verification: the look/placement of the flower in the left zone, whether the smoothed
  palm cursor feels responsive-but-steady, whether a deliberate move switches cells cleanly while a
  steady hover holds one (hysteresis + smoothing feel), and that the cursor lands on the right hex
  on a real mirrored feed — all need a real camera + hands. Correct by construction (pure geometry
  unit-tested, selector cargo-tested in 3.1, build/typecheck green) but not visually confirmed in
  this camera-less env. Belongs on the Phase 6.2 tuning + Phase 7.3 manual checklist; the pipeline
  gets a deterministic exercise via the Playwright suite (7.1). The status bar now shows the live
  *hovered* chord; the "chord only changes between strums" latch is task 3.4, which sits above this.

## 2026-11-22 12:53 WIB — task 3.3 finger-count chord-quality classification (Rust/WASM `fingercount`)

- did: implemented the left-hand chord-*quality* classifier `engine/src/fingercount.rs` (PRD §6.2),
  the second left-hand logic module (root comes from `hexmap`, quality from this). Reuses the exact
  ADR-0008 landmark boundary (flat 42-value `Float64Array`) and straightness metric as `gesture.rs`
  — made `gesture.rs`'s per-finger primitives (`finger_extended`, `landmarks_valid`, the finger
  index tables, `LANDMARK_COORDS`) `pub(crate)` and imported them rather than duplicating. Pure
  `FingerCountCore` holds the debounce state; `#[wasm_bindgen] FingerCountDetector` wraps it, plus a
  stateless `classifyChordQuality()` export + `ChordQuality` enum {Unknown, Major, Minor, Dominant7}.
  `classify_finger_count` only commits a quality for a *clean contiguous run* from the index — index
  = Major, index+middle = Minor, index+middle+ring = Dominant7 (stretch goal) — with every finger
  past the run, incl. the pinky, clearly curled; ambiguous/gap/raised-pinky/index-curled → Unknown.
  Default quality = Major; crucially an Unknown frame **holds** the last committed quality (quality
  is a *selection* like the hovered hex cell, not a momentary modifier like palm-mute), differing
  from the gesture detector's decay-to-Neutral — a different clear quality must persist `hold_frames`
  (default 3) frames to replace it; `reset()` → Major on tracking loss. Registered the module in
  `lib.rs` (`pub mod fingercount` + `pub use`). Recorded the clean-pattern / default-Major /
  hold-on-Unknown contract as ADR-0011.
- tested: `cd engine && cargo test` → 76 passed / 0 failed (was 59; +17 fingercount tests): the three
  qualities classify, fist/open-palm/raised-pinky/gap/middle-only → Unknown, wrong-length +
  non-finite input → Unknown, rotate+scale+translate invariance on a minor gesture, detector starts
  Major, debounce needs hold_frames to commit + rejects a single noisy frame, Unknown frame (empty
  slice *and* a fist) holds the last quality, switches after a sustained change, hold_frames=0→1
  immediate, reset→Major. `npm run build:engine` → wasm compiles clean; `engine.d.ts` now exports
  `class FingerCountDetector`, `enum ChordQuality`, `function classifyChordQuality(...)`. `npm run
  test` → 10 files / 85 tests still pass (frontend untouched — module not wired to the render loop
  yet); `npm run typecheck` exit 0; `npm run build` clean (engine_bg wasm bundled). No faked passes.
- next: task 3.4 — chord-change-only-between-strums rule: wire the hovered hex cell (3.2) + this
  committed finger-count quality through the strum engine so the *sounding* chord only updates on a
  strum boundary, never mid-ring.
- needs human verification: none for the pure logic (fully cargo-tested, deterministic). Whether a
  natural index / index+middle / index+middle+ring reliably reads as the intended quality on live
  MediaPipe landmarks, whether requiring the pinky curled is comfortable, and the right
  thresholds/hold_frames — all need a real camera + hands; belongs on the Phase 6.2 tuning + Phase
  7.3 manual checklist. The classifier isn't in the live render loop yet (3.4/3.5 consume it).

## 2026-11-22 13:05 WIB — task 3.4 chord-change-only-between-strums latch (Rust/WASM `chordlatch`)

- did: implemented the "sounding chord only changes on a strum boundary, never mid-ring" rule (PRD
  §6 / task 3.4), recorded as ADR-0012. New pure engine module `engine/src/chordlatch.rs`
  (ADR-0002 pure-core + thin-wasm-wrapper): `ChordLatchCore` holds a **pending** selection (hovered
  hex cell index + `ChordQuality`) updated every frame and a **committed** (sounding) selection that
  only moves when `commit()` is called. `set_pending` holds the last valid root on a negative (off-
  flower) root and the last quality on `Unknown`, so a transient frame can't arm a silent "no chord"
  strum; the committed chord **persists** across tracking loss (frontend never resets the latch per-
  frame, unlike the hexmap/finger-count detectors). Exported `#[wasm_bindgen] ChordLatch`
  (`setPending`, `commit(): bool`, `committedRoot/committedQuality/pendingRoot/pendingQuality`
  getters, `reset`) via `lib.rs`. Wired the whole chain into the render loop (`src/main.ts`): for the
  first time the `FingerCountDetector` (3.3) runs live — `processChord` flattens the chord hand's 21
  landmarks to the 42-value `Float64Array` (ADR-0008), gets the quality, and feeds hovered root +
  quality to `chordLatch.setPending`; on chord-hand loss it resets the finger-count detector
  (ADR-0011) but leaves the latch alone. `processStrum` now calls `chordLatch.commit()` when the
  strum detector returns ≥1 crossing this frame, *before* the pluck voices fire. The status bar's
  CHORD field now shows the *sounding* (committed) chord — new pure, unit-tested `src/chord.ts`
  (`chordLabel`) formats root letter + quality suffix (`""`/`m`/`7`) — instead of the live hovered
  cell (the flower accent still shows hover). engine.ts re-exports `ChordLatch`, `FingerCountDetector`,
  `ChordQuality` + instance types; freed the new wasm objects on beforeunload.
- tested: `cd engine && cargo test` → 86 passed / 0 failed (was 76; +10 chordlatch tests): starts
  empty/major, pending updates don't touch committed, commit moves pending→committed, **chord only
  changes on commit never mid-ring** (roam the left hand across cells while ringing, committed stays),
  commit reports unchanged on a re-strum of the same chord, negative root holds last valid pending
  root, Unknown quality holds last pending quality, **committed chord persists without a reset**
  (simulated dropout), reset fully clears both layers, quality-only change commits. `npm run test` →
  11 files / 95 tests pass (+10 in `src/chord.test.ts`: suffix per quality incl. unknown/out-of-range,
  label major/minor/dom7, null/undefined/empty-root placeholder, em-dash). `npm run typecheck` exit 0;
  `npm run build:engine` → wasm clean (`engine.d.ts` now exports `class ChordLatch`); `npm run build`
  → clean (20 modules, engine_bg wasm 40.49 kB bundled). No faked passes.
- next: task 3.5 — chord shape data table (A–G, major/minor, 6-string fret positions) wired into the
  audio engine so the committed hex root + quality actually changes the note set `setChord()` plays.
- needs human verification: none for the pure logic (latch + label fully tested, deterministic). The
  *feel* of the rule on a real camera — that moving the fretting hand doesn't change the sound until
  you strum, that the committed chord in the status bar matches what you hear, and that committing on
  the first crossing frame of a stroke feels right (vs. a stricter one-commit-per-stroke) — needs a
  real camera + hands + speakers; belongs on the Phase 6.2 tuning + Phase 7.3 manual checklist. The
  committed chord doesn't yet change the audible notes (still the placeholder test chord) until 3.5.

## 2026-11-22 13:10 WIB — task 3.5 chord shape data table → audio note set

- did: closed the last Phase-3 box — the hovered hex root + finger-count quality now actually change
  what note set a strum plays (PRD §6). New pure, unit-tested `src/chords.ts` (ADR-0002 split; no new
  ADR — it realises ADR-0009's `setChord()` note-set contract and the ADR-0012 commit boundary):
  a **fret-position table** of standard guitar chord shapes — one fret per string in standard tuning,
  index 0 = low E (E2) … 5 = high e (E4), matching `STRING_NOTE_NAMES`/`OPEN_STRING_NOTES` — for every
  A–G in major, minor, and the stretch-goal dominant-7th. Open-position voicings where one exists
  (C `x32010`, D, E, Em, Am, G, A, D7, E7, …) and E-shape / A-shape barre shapes for the roots with no
  natural open voicing (B major, C/F/G minor, F major, etc.), so every mapping is a real, correctly-
  voiced chord. `MUTED` (-1) marks an unsounded string. `chordShape(root, quality)` is case-insensitive,
  trims, falls back to the major table for `Unknown`, returns `null` for a non-A–G root;
  `chordFrequencies(root, quality)` resolves each non-muted string to `midiToFrequency(open+fret)` and
  yields **0 Hz for muted strings / unknown roots** — the audio engine's `pluck` already treats a
  non-positive freq as "don't sound this string" (ADR-0009), so no `audio.ts` change was needed.
  Wired into `src/main.ts`: `processStrum` now commits *and*, when the committed chord actually changes,
  calls new `applyCommittedChord()` → maps `chordLatch.committedRoot`→`HexMap.cellChord` letter +
  `committedQuality`, builds the frequency set, and hands it to `audioEngine.setChord()` — so the strum
  that commits the change also sounds the new chord. Nothing valid committed yet (root < 0) leaves the
  engine's default open-string test chord intact rather than silencing it.
- tested: `npm run test` → 12 files / 109 tests pass (+14 in `src/chords.test.ts`: six-string ref order/
  MIDI, shape lookup for every A–G × 3 qualities, case/trim-insensitivity, unknown/empty/null root →
  null, Unknown→major fallback, major≠minor per root; **harmonic correctness** — every major/minor/dom7
  voicing sounds only chord tones and contains the root (and the minor 3rd / the b7), checked against
  theory-derived pitch-class sets; C major = classic `x32010`; `chordFrequencies` six entries, 0 for
  muted, exact open+fret frequency on D major, all-zero for unknown root no-throw, A maj≠A min).
  `npm run typecheck` exit 0; `npm run build` → clean (21 modules, engine_bg wasm 40.49 kB bundled);
  `npm run test:engine` → cargo 86 passed / 0 failed (engine untouched this task). No faked passes.
- next: task 4.1 — Rust/WASM `powerstrip` module: fret-from-horizontal-position (0–12 with marker
  positions) and string-pair-from-height (upper = 6th+5th, lower = 5th+4th), with unit tests.
- needs human verification: none for the pure logic (chord table + wiring fully tested, deterministic).
  Whether each chord *sounds* right through the placeholder triangle-osc timbre, whether the barre-shape
  voicings for C/F/G minor + B major sound as good as the open ones, and that strumming a hovered cell
  audibly changes the chord on a real camera + speakers — need Yaya's machine; belongs on the Phase 7.3
  manual checklist and gets a deterministic exercise via the Playwright keyboard-fallback + Web-Audio
  suite in task 7.1. Phase 3 is now complete; Phase 4 (power chords) is next.

## 2026-11-22 13:12 WIB — task 4.1 Rust/WASM `powerstrip` module (fret-from-x, string-pair-from-y)

- did: opened Phase 4 with the power-chord strip geometry engine module
  `engine/src/powerstrip.rs` (PRD §7), following the ADR-0002 pure-core + thin-wasm-wrapper pattern.
  Pure `PowerStripCore` holds the strip rectangle + fret count; every query is **stateless** (no
  hysteresis — unlike hexmap/strum; the Power/Chord mode latch is frontend work in 4.2). `fret_at_x`
  maps x to a fret over `max_fret+1` (default 13) equal-width cells — `floor((x−left)/cell_width)`,
  inclusive right edge clamped to the top fret, off-strip → None; frets are monotonic in x so "moving
  right raises pitch" holds. `pair_at_y` splits the strip height at its midline → `PowerPair::Upper`
  (root string 0 = 6th/low E, fifth 1 = 5th/A) / `Lower` (root 1 = 5th/A, fifth 2 = 4th/D), midline
  counts as upper; the optional octave is two strings below the root (Upper→2, Lower→3, the standard
  E-/A-shape octave). `fret_marker_x` gives a cell's centre for the 4.2 renderer. Edges normalised to
  any argument order, degenerate/non-finite rect floored so no divide-by-zero, `max_fret` floored ≥1.
  No note-name math in the engine (stays in TS, task 4.3). Thin `#[wasm_bindgen] PowerStrip` wrapper
  mirrors HexMap's i32 boundary encoding: fret `-1`=off-strip, pair `-1`/`0`/`1`; plus
  `root/fifth/octaveString(pair)` index getters, `contains`, `fretCount`, `maxFret`. Registered in
  `lib.rs` (`pub mod powerstrip` + `pub use {PowerPair, PowerStrip}`). Recorded the fret-cell /
  midline-split / octave-string / stateless contract as ADR-0013.
- tested: `cd engine && cargo test` → 106 passed / 0 failed (was 86; +20 powerstrip tests): fret
  count = max+1, left edge → 0, right edge clamps to max, mid-cell steps across all 13 frets,
  off-strip → None, **monotonic frets (moving-right-raises-pitch)**, upper/lower pair string indices,
  midline-counts-as-upper, pair off-strip → None, `contains` whole-rect incl. inclusive corners,
  **fret-marker centres round-trip back to their own fret**, edges normalised regardless of argument
  order, degenerate + non-finite rect guarded, max_fret floored ≥1, custom max_fret honoured, i32
  boundary decode, wrapper string-index + boundary-encoding checks. `npm run build:engine` → wasm
  compiles clean; `engine.d.ts` now exports `class PowerStrip` + `enum PowerPair`. `npm run typecheck`
  exit 0; `npm run test` → 12 files / 109 tests still pass (frontend untouched — module not wired to
  the render loop yet); `npm run build` → clean (engine_bg wasm 44.53 kB bundled). No faked passes.
- next: task 4.2 — Power Chord Strip UI above the hex grid; entering it switches to Power mode,
  leaving it back to Chord mode. Wires this module (`contains` for the mode switch, `fretMarkerX` for
  the markers) into the live render loop for the first time.
- needs human verification: none for the pure logic (strip geometry fully cargo-tested,
  deterministic). The *feel* of the fret spacing (is 13 cells across the strip width comfortable to
  hit a target fret), whether the midline split between the two string pairs is easy to land
  deliberately, and the default strip size/placement need a real camera + hands; belongs on the Phase
  6.2 tuning + Phase 7.3 manual checklist. The module isn't in the render loop yet (4.2/4.3 consume
  it).

## 2026-11-22 13:18 WIB — task 4.2 Power Chord Strip UI + Chord/Power mode switch

- did: built the power-chord strip UI above the hex flower and the Chord↔Power mode switch (PRD §7 /
  task 4.2), wiring the `powerstrip` engine module (4.1) into the live render loop for the first
  time. No new ADR — ADR-0013 already anticipated this ("the Power/Chord mode latch and any
  dwell/hysteresis on the mode boundary belong to the frontend wiring in task 4.2, above this
  module"); the strip-size/placement fractions and the gap-band hysteresis are the feel-tuning that
  ADR explicitly leaves to the frontend / Phase 6.2 sliders. Following the ADR-0002 split:
  * `src/powerstrip.ts` — PURE, unit-tested: `computeLeftZoneLayout` carves a strip band off the top
    of the left zone (inset by a margin fraction, `stripHeightFraction` tall) and leaves the rest,
    below a neutral `gapFraction` band, for the hex flower — all fractions clamped so a degenerate /
    non-finite / inverted zone still yields non-inverted, finite rects; `rectContains` (edge-inclusive,
    null/non-finite → outside); and `nextPlayMode(current, inStrip, inHexArea)` — the mode rule:
    cursor on the strip → Power, in the hex area → Chord, in the gap / no hand → **hold** the current
    mode (the gap gives the boundary hysteresis so it can't flicker, and a brief hand dropout can't
    flip the mode). Plus the thin DOM `drawPowerStrip` (strip rect accented in Power mode, fret-marker
    ticks + inlay dots at 3/5/7/9 and a double dot at 12, the string-pair midline with "E/A" / "A/D"
    labels, a POWER caption, and a hovered-fret-column highlight in the hovered half) — not unit-tested
    (needs a 2D context), exercised by e2e/human.
  * `src/engine.ts` — re-export `PowerStrip` + `PowerPair` and the `PowerStripInstance` type so the
    frontend reaches the 4.1 class through the one init wrapper.
  * `src/main.ts` — `processChord` now computes the left-zone split, (re)builds a `PowerStrip` sized to
    the strip rect on geometry change (caching the `fretMarkerX` centres), builds the hex flower in the
    strip-reduced hex area (the flower shifted down to make room), tracks `playMode` from the smoothed
    cursor via `nextPlayMode`, and draws the strip (accented + hovered fret/pair when in Power mode).
    The status bar's MODE field now shows the live `playMode` (was hardcoded "Chord"). Freed the new
    wasm object on beforeunload. The strip only switches mode + draws for 4.2; restricting the strum to
    the root/fifth/octave strings and the "G5 (fret 3, low E)" readout is task 4.3.
- tested: `npm run test` → 13 files / 125 tests pass (+16 in `src/powerstrip.test.ts`: strip-above-hex
  ordering, the 40px neutral gap, left/right/top insets, hex area spanning the full width, non-inverted
  rects on three degenerate zones, non-finite-input clamping, hex-top floored to the zone bottom on a
  tiny zone; rectContains interior/edge/outside/null/non-finite; nextPlayMode enter-Power / return-Chord
  / hold-in-gap / hold-on-dropout / strip-priority / no-flicker round trip). `npm run typecheck` exit 0;
  `npm run test:engine` → cargo 106 passed / 0 failed (engine untouched this task); `npm run build` →
  clean (22 modules, engine_bg wasm 44.53 kB bundled). No faked passes.
- next: task 4.3 — Power-mode strumming restricted to the 2 (optionally 3 with octave) relevant
  strings; status bar shows the note name e.g. "G5 (fret 3, low E)". Reads `fretAtX`/`pairAtY` +
  `rootString`/`fifthString`/`octaveString` (and the new `playMode` state) to gate the strum voices and
  format the readout; the note-name math lives in TS alongside `notes.ts`/`chords.ts` (ADR-0013 §4).
- needs human verification: the look/placement of the strip above the flower (does the band read as a
  fretboard strip, do the inlay dots + pair labels make the mapping obvious), and crucially whether
  moving the left hand up into the strip *feels* like a deliberate Chord→Power switch (is the band in a
  comfortable reach, is the gap-band hysteresis wide enough to not flicker but not so wide it feels
  sticky) — all need a real camera + hands. Correct by construction (pure layout + mode logic unit-
  tested, geometry cargo-tested in 4.1, build/typecheck green) but not visually confirmed in this
  camera-less env. Belongs on the Phase 6.2 tuning + Phase 7.3 manual checklist; the pipeline gets a
  deterministic exercise via the Playwright suite (7.1).

## 2026-11-23 13:50 WIB — task 4.3 power-mode restricted strum + "G5 (fret 3, low E)" readout

- environment (new cloud container, not Yaya's machine): fresh clone had no `wasm32-unknown-unknown`
  target, no `wasm-pack`, no `node_modules`. Installed via `rustup target add`, `cargo install
  wasm-pack`, `npm ci`. wasm-pack's own binaryen download from GitHub releases is blocked here, and
  apt's binaryen 108 is **too old for wasm-bindgen 0.2.130**: the optimized wasm fails to instantiate in
  Chromium (`WebAssembly.Table.set(): ... function-typed object`) even with explicit `--enable-*` feature
  flags. Fix (env only, no repo change): `npm i -g binaryen@latest` (wasm-opt 132) — wasm-pack picks it
  up from PATH and the engine inits fine. If a future session sees that error, check `wasm-opt
  --version` first.
- did: closed Phase 4 (ADR-0014). New pure `src/voicing.ts`: `powerVoicing(sel, withOctave)` builds a
  six-string note set with only the root (open string + fret), fifth (+7) and optional octave (+12)
  non-zero, on the string indices the engine's `powerstrip` returned — the other strings are 0 Hz, which
  the audio engine already ignores, so that *is* the strum restriction; `powerChordLabel` → "G5 (fret 3,
  low E)"; `chordVoicing` wraps the 3.5 chord table; `selectVoicing(mode, power, chord)` picks which one
  a strum sounds; every voicing carries a `key` so the engine only reloads on an actual change. Added
  `midiToPitchClass` to `notes.ts`. `main.ts`: Power mode now records a held `pendingPower` (last valid
  fret + root/fifth/octave strings from `PowerStrip`), and on each strum frame commits the chord latch
  then calls `applySoundingVoicing()` (replaces `applyCommittedChord`); the status-bar CHORD field shows
  the sounding voicing label; the strip's caption previews the hovered power chord. `audio.ts`
  `setChord()` now damps strings the new voicing doesn't sound (no low E bleeding under an A5/C).
- tested: `cargo test` 106 passed / 0 failed; `npm run test` 14 files / 145 tests passed (+18 voicing
  tests: PRD label example, sharp roots, G5 = G2/D3/G3 with the rest silent, exactly 2 strings without
  octave, lower-pair C5, perfect-fifth + octave ratios at every fret on both pairs, pitch rises with fret,
  key identity, invalid selections, select logic; +2 `midiToPitchClass`); `npm run typecheck` 0;
  `npm run build` clean. **New: headless-Chromium smoke load** of `vite preview` with a fake camera —
  the WASM engine initializes and the strip / hex flower / strings render; MediaPipe assets can't load
  here (CDN blocked by the sandbox proxy), expected per ADR-0005.
- next: Phase 5 — task 5.1 Karplus-Strong acoustic voice. Also noticed (not yet wired): the 2.3
  palm-mute / fist-stop `GestureDetector` exists in the engine but isn't connected to audio in the render
  loop; plan to wire it with 5.1 (palm mute = short damped Karplus-Strong decay, fist = `stopAll`).
  Cosmetic: the centred "LEFT HAND · chords" zone caption overlaps the hex flower — fix in polish.
- needs human verification: whether the power-chord strum feels "tight and heavy" (PRD §7), whether the
  octave should default on, and that the strip preview / status label match what is heard — needs a real
  camera + hands + speakers (Phase 7.3 checklist).

## 2026-11-23 14:05 WIB — task 5.1 Karplus-Strong acoustic voice

- did: new Rust engine module `engine/src/pluck.rs` (ADR-0015): extended Karplus-Strong — seeded
  xorshift noise burst lowpassed by `brightness`, DC-removed + peak-normalised; two-point-average loop
  filter × loss `ρ = 10^(−3/(t60·f))`; first-order allpass for fractional-delay tuning (δ kept in
  [0.1,1.1)); output peak-normalised with a 10 ms tail fade. Exported as `renderPluck(...) →
  Float32Array`. `audio.ts`: voices are now `AudioBufferSourceNode`s playing the rendered buffer through
  the per-voice gain; renderer injected via `setPluckRenderer` (main.ts installs `renderPluck` once the
  engine inits); triangle-oscillator fallback before then / on render failure. New pure
  `acousticPluckParams(freq, velocity, muted)` (ring time by pitch, brightness by velocity, palm-mute
  params) — `pluck()` takes an optional `muted` flag, ready for the gesture wiring.
- tested: `cargo test` 118 passed / 0 failed (+12 pluck: length, **pitch < 1 cent** at E2/A2/D3/G3/B3/E4/E5
  via autocorrelation — measured errors 0.01–0.11 cent, bounded/finite/peak 1, T60 decay band, short-T60
  thud, silent tail, brightness tilt, determinism + seed-0 remap, no DC, unrenderable → empty, bad params
  sanitised, wasm export = core). `npm run test` 151 passed (+6 `acousticPluckParams`). typecheck 0,
  build clean, headless smoke load OK (engine inits, renders).
- next: wire the 2.3 palm-mute / fist-stop `GestureDetector` into the strum path (small follow-up
  commit), then task 5.2 electric clean + distortion (Rust waveshaper curve + tone control).
- needs human verification: whether the KS acoustic voice *sounds* like a guitar on real speakers, the
  ring-time/brightness feel, and loudness balance across strings — no audio output in this env.

## 2026-11-23 14:15 WIB — wire palm-mute / fist-stop gestures into audio (2.3 follow-up)

- did: the 2.3 `GestureDetector` was cargo-tested but never connected to sound. New pure
  `src/strumgesture.ts`: `strumGestureAction(prev, cur)` — entering a fist → `stopAll` once, plucks
  suppressed while the fist is held (so the stop sticks if the closed hand drifts across the strings);
  open palm → plucks palm-muted (`pluck(i, v, true)` → KS with T60 0.18 s, darker); `modeLabel` adds the
  modifier to the status bar MODE field ("Power · palm mute", "Chord · stop"). `main.ts` runs the
  detector (hold 3 frames) on the strum hand's flattened landmarks each frame and resets it on hand loss.
  No new ADR: realises ADR-0008/0009's planned wiring.
- tested: `npm run test` 158 passed (+7 strumgesture), typecheck 0, build clean, smoke load OK.
  `cargo test` unchanged (118).
- needs human verification: whether a real flat palm / fist reads reliably while strumming and whether
  palm-muted strums feel right — real camera + hands.
