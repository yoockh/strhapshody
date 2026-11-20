# TASKS

One box = one commit. Check it in the same commit that completes it. Work top to bottom;
order encodes dependencies. See `CLAUDE.md` for workflow rules.

## Phase 0 — Scaffold

- [x] 0.1 Vite + TypeScript scaffold: dev server runs, blank mirrored canvas showing webcam
      feed placeholder (can be a static test pattern until 0.4).
- [ ] 0.2 Rust `engine/` crate scaffold, wasm-pack build config, a trivial exported function
      with a round-trip test from TS (prove the WASM pipeline works end to end) + `cargo test`
      passing on a dummy unit test.
- [ ] 0.3 Test tooling wired up: `npm run test` (vitest) and `cargo test` both runnable and
      documented in `TESTING.md`; add a `package.json` script `test:all` that runs both.
- [ ] 0.4 Real webcam capture via `getUserMedia`, mirrored on canvas, graceful error if no
      camera permission.

## Phase 1 — Hand tracking foundation

- [ ] 1.1 Integrate `@mediapipe/tasks-vision` HandLandmarker, draw both hands' landmarks as an
      overlay on the canvas.
- [ ] 1.2 Handedness assignment (MediaPipe handedness + screen-side fallback per PRD §13),
      left/right zone split rendered, status bar skeleton (chord/mode/instrument/tracking
      health placeholders).
- [ ] 1.3 One Euro filter smoothing as a Rust/WASM `smoothing` module; `cargo test` with
      synthetic jittery input sequences proving noise reduction without excessive lag.

## Phase 2 — Right hand strumming

- [ ] 2.1 Six virtual string lines rendered in the right zone.
- [ ] 2.2 Rust/WASM `strum` module: line-crossing detection, direction (up/down), velocity from
      a landmark trajectory; `cargo test` with synthetic up/down/slow/fast trajectories
      covering edge cases (near-miss, double-cross in one frame).
- [ ] 2.3 Palm-mute (open flat palm over strings) and fist-stop (closed fist) gesture
      detection from landmark geometry; unit tests with synthetic hand-shape landmark sets.
- [ ] 2.4 Web Audio engine skeleton: 6 string voices, a single hardcoded test chord, pluck
      synthesis wired to strum events from 2.2 (placeholder timbre is fine here, real
      instruments come in Phase 5).

## Phase 3 — Chord selection (hex map)

- [ ] 3.1 Rust/WASM `hexmap` module: circle-of-fifths hex layout math, point-in-hex test,
      hysteresis at borders; `cargo test` covering center/ring cells and border-flicker cases.
- [ ] 3.2 Hex flower UI rendered in the left zone, palm-center cursor tracked and highlighting
      the active hex.
- [ ] 3.3 Finger-count gesture classification (index / index+middle / index+middle+ring) as a
      Rust/WASM function; unit tests with synthetic extended/curled finger landmark configs.
- [ ] 3.4 Chord-change-only-between-strums rule: wire hex+gesture state through the strum
      engine so the sounding chord only updates on a strum boundary, never mid-ring.
- [ ] 3.5 Chord shape data table (A–G, major/minor, 6-string fret positions) wired into the
      audio engine so hex + gesture actually changes what note set strums play.

## Phase 4 — Power chords

- [ ] 4.1 Rust/WASM `powerstrip` module: fret-from-horizontal-position (0–12, with fret marker
      positions) and string-pair-from-height (upper = 6th+5th, lower = 5th+4th); unit tests.
- [ ] 4.2 Power Chord Strip UI above the hex grid; entering it switches to Power mode,
      returning to the hex area switches back to Chord mode.
- [ ] 4.3 Power-mode strumming restricted to the 2 (optionally 3 with octave) relevant strings;
      status bar shows note name e.g. "G5 (fret 3, low E)".

## Phase 5 — Sound quality

- [ ] 5.1 Acoustic instrument voice (Karplus-Strong plucked-string model is the pragmatic
      choice — no sample licensing, genuinely testable by inspecting the output buffer).
- [ ] 5.2 Electric clean + distortion voice: Web Audio `WaveShaperNode` driven by a Rust/WASM
      curve generator with a drive parameter, plus a basic tone control (lowpass/shelf).
- [ ] 5.3 Instrument toggle (on-screen + keyboard shortcut), volume control, simple reverb
      (ConvolverNode or algorithmic) amount control.

## Phase 6 — Calibration, settings, fallback

- [ ] 6.1 First-run calibration flow (~20s): capture each hand's comfortable range, resize
      zones to match.
- [ ] 6.2 Settings panel: handedness swap, sensitivity sliders (strum threshold, smoothing,
      hex size), persisted in localStorage.
- [ ] 6.3 Lighting-too-dark / hand-out-of-frame warning banners driven by MediaPipe tracking
      confidence + frame presence.
- [ ] 6.4 Keyboard fallback: letter keys A–G select chord, shift toggles major/minor, spacebar
      strums down, shift+spacebar strums up. Doubles as a debug/demo mode without a camera.

## Phase 7 — Testing & polish pass

- [ ] 7.1 Playwright end-to-end test: launch with `--use-fake-device-for-media-stream` and a
      fake video file, drive the keyboard-fallback path through a C–G–Am–F progression, assert
      audio context produced sound events for each chord.
- [ ] 7.2 Latency measurement harness: timestamp strum-event detection vs. audio start, log
      p50/p95 against the <100ms (ideal <60ms) target from PRD §10; record results in DEVLOG.md.
- [ ] 7.3 `README.md` rewritten with real setup/run/build instructions, known limitations
      (needs real webcam + hands for full experience — see "needs human verification" entries
      in DEVLOG.md), and a manual test checklist for Yaya to run once with her actual camera.

## Post-MVP (not required for "done", don't block on these)

- [ ] P.1 Tauri (Rust) desktop wrapper for native packaging — requires one manual
      `sudo pacman -S webkit2gtk-4.1 libappindicator-gtk3 librsvg patchelf` run by Yaya first;
      ask her when MVP is otherwise complete, don't block MVP on it.
- [ ] P.2 7th-chord gesture (stretch goal from PRD §6.2), custom hex layouts, metronome /
      backing tracks, recording/export, more instruments.
