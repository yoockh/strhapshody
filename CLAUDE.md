# strhapshody — agent operating guide

Read this file plus `TASKS.md` and `DECISIONS.md` at the start of every session. This is a
**long-running, multi-session build**: you will not finish in one sitting, and no human will
watch you work in real time. Treat `TASKS.md` as your persistent memory of what's left, and
`DEVLOG.md` as your memory of what you already learned. Nobody will remind you of context —
re-derive it from these files every time you start.

## What this is

Air guitar app: webcam + hand tracking turns your hands into a playable guitar. Left hand
picks the chord (hex grid + power chord strip), right hand strums virtual strings. Full spec
in `docs/PRD.md`. Read it once; don't re-litigate it, it's the source of truth for *what*,
this file is the source of truth for *how*.

## Stack (do not re-decide this — see DECISIONS.md ADR-0001 for why)

- **Frontend shell**: Vite + TypeScript, plain web app, runs in Chrome/Edge via `npm run dev`.
  No Electron/Tauri for MVP — see ADR-0001.
- **Hand tracking**: `@mediapipe/tasks-vision` (HandLandmarker), runs in-browser via WASM.
  Do not try to reimplement hand tracking in Rust — not worth it, MediaPipe is free and good.
- **Audio**: Web Audio API directly (`AudioContext`, `WaveShaperNode`, `ConvolverNode` for
  reverb). Don't add an audio library unless something concrete is missing.
- **Core logic engine**: Rust, compiled to WASM via `wasm-pack`, lives in `engine/`. This is
  where the actual value of Rust is: deterministic, camera-free, mic-free logic that's trivial
  to unit test with `cargo test`. Specifically:
  - hex-grid geometry + hysteresis (chord selection)
  - finger-count gesture classification
  - power chord strip math (fret from X, string pair from Y)
  - strum crossing/direction/velocity detection from landmark trajectories
  - One Euro filter smoothing
  - waveshaper curve generation for distortion
  All of the above are pure functions: `landmarks in -> decision out`. No browser APIs. That's
  the whole point — testable without a camera or a human in the loop.
- Frontend calls into the WASM engine for all of the above; it does NOT reimplement that logic
  in TypeScript. If WASM integration ever truly blocks you after a real attempt, fall back to a
  TS port of just the blocking piece, write down why in DECISIONS.md, and keep moving — don't
  stall the whole project on one module.

## Workflow rules (non-negotiable)

1. One feature = one commit. Check the box in `TASKS.md` in the SAME commit as the feature.
2. Before every commit: run `cargo test` (in `engine/`) and the frontend test command
   (`npm run test`, vitest) — see `TESTING.md`. Only commit green. If you can't make something
   fully green, commit what's solid, leave the task unchecked, and write the blocker in
   `DEVLOG.md` instead of faking a pass.
3. Commit message format: Conventional Commits — `feat:`, `fix:`, `test:`, `docs:`, `chore:`,
   `refactor:`. Short imperative subject (≤72 chars), blank line, then a short body saying what
   and why if it's not obvious. No "misc fixes", no giant multi-feature commits.
4. After committing, `git push`. Credentials are already configured on this machine — just push.
5. At the end of every work session (whether you stopped by choice or ran out of budget),
   append a dated entry to `DEVLOG.md`: what you did, what you tested, what's next. This is the
   only way the next session (possibly a different context window) knows where things stand.
6. Work tasks top-to-bottom in `TASKS.md` phase order unless a task is blocked — dependencies
   are ordered that way on purpose (engine before UI that calls it, etc).
7. Don't ask the human mid-task. The maintainer wants to receive finished work, not questions. Make reasonable calls yourself, document them in DECISIONS.md, keep going. The only
   exception is something genuinely destructive or requiring the maintainer's password/credentials.
8. No camera/mic in this execution environment. For anything needing real camera input
   (MediaPipe tracking accuracy, actual audio latency feel), build it so it's correct by
   construction and unit-testable at the logic layer, and use Playwright with
   `--use-fake-device-for-media-stream` + a fake video file to exercise the full pipeline
   end-to-end deterministically. Flag anything that genuinely needs a human with real hands in
   `DEVLOG.md` under "needs human verification" instead of guessing it's fine.

## Definition of done for the whole project

All MVP boxes in `TASKS.md` (Phases 0–7) checked, tests green, pushed to `origin/main`, and
`README.md` has real setup/run instructions a stranger could follow.
