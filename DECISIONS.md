# DECISIONS

Architecture Decision Records. Append new ones at the bottom, don't edit history — if a
decision changes, add a new ADR that supersedes the old one and say so.

## ADR-0001: Web app (Vite+TS) shell, not Tauri/Electron, for MVP

**Context:** PRD §4 recommends a browser web app (no installer, webcam/hand-tracking/audio all
browser-native) but mentions a Tauri/Electron desktop wrapper could be added "later". Yaya
asked for Rust "if possible" but left the final call to the builder.

**Constraints found on this machine:** no `cargo`/`rustc` installed, no `sudo` without a
password prompt, no `webkit2gtk-4.1`/`libappindicator-gtk3` (required for Tauri on Linux) —
installing them needs a manual `sudo pacman -S ...` only Yaya can run. Home internet is slow
(~30-70 KB/s), so large toolchain downloads are a real risk to an unattended long-running build.

**Decision:** Ship MVP as a pure browser web app (Vite + TypeScript), matching the PRD's own
primary recommendation. Use `rustup` (no sudo required, installs to `~/.cargo`/`~/.rustup`) to
get a Rust toolchain for a `wasm-pack`-built WASM engine (`engine/`) that implements the actual
deterministic game logic (hex math, gesture classification, strum detection, power chord math,
distortion curves). This gets genuine, load-bearing Rust into the project — not a toy — while
avoiding the sudo-gated, slow-to-install Tauri system dependencies. Tauri packaging is deferred
to Post-MVP task P.1, to be done once Yaya runs one `pacman` command herself.

**Consequences:** the app runs via `npm run dev` in Chrome/Edge, not as a standalone desktop
binary, until P.1 happens. This matches the PRD's stated MVP bar ("runs on laptop-class
Chrome/Edge/Safari") exactly, so it's not a scope cut, just a sequencing choice.

## ADR-0002: Rust lives only where it doesn't need a camera or a human

**Context:** Hand tracking (MediaPipe) and raw audio I/O (Web Audio API) are both solved,
battle-tested, free, in-browser. Reimplementing either in Rust would mean either FFI bindings
to MediaPipe (fragile, not really "using Rust" in a meaningful way) or training/porting hand
landmark models from scratch (unreasonable scope for this project).

**Decision:** Rust/WASM owns exactly the logic that is pure-function and camera/mic-free: hex
geometry + hysteresis, finger-count gesture classification from landmark coordinates, strum
crossing/direction/velocity math, power chord strip math, One Euro filter smoothing, and
waveshaper curve generation. Everything that needs a live camera frame or live audio hardware
stays in JS/WASM-MediaPipe/Web Audio, where it's proven to work. Why this split matters for a
long-running unattended agent: the Rust layer is 100% unit-testable with synthetic inputs via
`cargo test`, with zero human or camera in the loop — exactly what an agent working alone needs
to self-verify correctness.

## ADR-0003: Open questions from PRD §15 resolved without asking

No further input was available (Yaya explicitly asked for a finished product, not a Q&A). All
five open questions were resolved by keeping the PRD's own stated defaults/assumptions:

1. Power chord strings: "top two strings" = lowest-pitched pair (6th + 5th, low E + A) as the
   default/upper-half mapping, per PRD §7 — this is what real power chords use.
2. Hex layout: circle-of-fifths as specified in PRD §6.1, with layout configurable later
   (Phase 6 settings can expose alternate orderings as a stretch, not required for MVP).
3. Minor chords: finger-count gestures as specified in PRD §6.2 (index = major, index+middle =
   minor) — no evidence it's uncomfortable, and changing it would mean redesigning the whole
   gesture vocabulary with no input to redesign it against.
4. Target laptop: unknown, so performance targets from PRD §10 are treated as the target
   (30-60 FPS tracking, <100ms strum latency) rather than tuning for a specific machine.
5. Who builds it: an autonomous coding agent (Claude Code CLI), orchestrated long-running,
   following this file tree. Noted here since the PRD phrased this as a question about "your
   friend".
