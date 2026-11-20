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
