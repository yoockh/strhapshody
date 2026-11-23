# TESTING

Two test suites, both must be green before any commit (per `CLAUDE.md` workflow rule 2).

## Rust engine (`engine/`)

```
cd engine && cargo test
```

Every pure-logic module (hexmap, strum, smoothing, powerstrip, gesture, distortion curve) gets
unit tests with **synthetic** inputs — hand-constructed landmark coordinate sequences, not real
camera data (there is no camera in this execution environment). Cover:
- Nominal cases (clearly-in-a-hex, clean up/down strum, clearly-open-palm, etc).
- Boundary/noise cases (hysteresis border flicker, near-miss crossings, jittery input into the
  smoothing filter).
- At least one regression test per bug found and fixed during the build (add it, don't just
  patch and move on).

## Frontend (root)

```
npm run test        # vitest, unit tests for TS glue code (non-engine logic, UI state)
npm run test:e2e    # playwright end-to-end, see below
```

Playwright end-to-end (`e2e/`, task 7.1) is the closest thing to "real" testing available
without a human. `npm run test:e2e` builds the engine, then Playwright builds the app and serves it
with `vite preview`, launches Chromium with `--use-fake-device-for-media-stream` and
`--use-file-for-fake-video-capture` (a small Y4M clip generated on the fly by `e2e/fake-video.ts`,
not committed), and drives the **keyboard fallback** (task 6.4) rather than trying to fake MediaPipe
hand landmarks. Assertions read the read-only `window.__strhapshody.state()` hook: the sounding
chord label, the loaded note set, how many voices actually started, and the RMS level of the master
output (an `AnalyserNode` tap) — so "it made sound" is measured, not assumed. Covered: camera +
engine start, the C–G–Am–F progression (label, note count, lowest note, voices, level), the
chord-changes-only-on-strum rule, upstroke on all three instruments, settings persistence across a
reload, and the unload use-after-free regression.

First run on a new machine: `npx playwright install chromium` (downloads the browser Playwright
drives). Traces are off by default; rerun a failing test with `--trace on` to debug it.

## What can't be tested without a human

Real hand-tracking accuracy, real strum feel/latency-as-experienced, real lighting conditions,
and genuine "does this feel fun to play" are NOT verifiable by an agent alone. Don't fake a pass
on these. Log them in `DEVLOG.md` under a "needs human verification" heading as they come up,
and the Phase 7.3 README manual checklist is where Yaya actually tries it with her own hands.

## Running everything at once

`npm run test:all` (added in task 0.3) runs both `cargo test` and `npm run test`.
