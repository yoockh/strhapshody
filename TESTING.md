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
npm run test:e2e     # playwright, see below
```

Playwright end-to-end (Phase 7.1) is the closest thing to "real" testing available without a
human: launch Chromium with `--use-fake-device-for-media-stream` and a fake video file as the
"camera", drive the **keyboard fallback** (Phase 6.4) rather than trying to fake MediaPipe hand
landmarks convincingly, and assert on Web Audio behavior (e.g. via a recording/analysis node)
that chord changes and strums actually produced sound. This validates the full UI/audio wiring
even though it can't validate real hand-tracking accuracy.

## What can't be tested without a human

Real hand-tracking accuracy, real strum feel/latency-as-experienced, real lighting conditions,
and genuine "does this feel fun to play" are NOT verifiable by an agent alone. Don't fake a pass
on these. Log them in `DEVLOG.md` under a "needs human verification" heading as they come up,
and the Phase 7.3 README manual checklist is where Yaya actually tries it with her own hands.

## Running everything at once

`npm run test:all` (added in task 0.3) runs both `cargo test` and `npm run test`.
