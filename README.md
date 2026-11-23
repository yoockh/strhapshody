# strhapshody

Air guitar in the browser. Your webcam watches both hands: the **left hand picks the chord** on a
hex grid (or a power-chord strip), the **right hand strums** six virtual strings. Everything runs
locally on your laptop — no video leaves the machine.

- **Hand tracking:** Google MediaPipe HandLandmarker (in-browser WASM).
- **Logic engine:** Rust compiled to WebAssembly (`engine/`) — chord grid, finger counting, strum
  detection, power-chord maths, smoothing, and the sound generators (Karplus-Strong strings,
  distortion curve, reverb impulse).
- **Audio:** Web Audio API — acoustic, electric clean and electric distortion, with reverb.

Spec: [`docs/PRD.md`](docs/PRD.md). Design decisions: [`DECISIONS.md`](DECISIONS.md). Build log:
[`DEVLOG.md`](DEVLOG.md).

---

## How to play

```
┌──────────────── status bar: CHORD · MODE · INSTRUMENT · TRACKING ────────────────┐
│  LEFT HAND · chords                     │  RIGHT HAND · strum                     │
│  ┌──────── power-chord strip ────────┐  │  ───────────── low E                    │
│  │ E/A  frets 0 … 12 →               │  │  ───────────── A                        │
│  │ A/D                               │  │  ───────────── D                        │
│  └───────────────────────────────────┘  │  ───────────── G                        │
│                  G                      │  ───────────── B                        │
│              F       D                  │  ───────────── high e                   │
│                  C                      │                                         │
│              B       A                  │                                         │
│                  E                      │                                         │
└─────────────────────────────────────────┴─────────────────────────────────────────┘
```

The picture is mirrored like a mirror, so your left hand appears on the left.

**Left hand (chords)**

| Do this | Result |
| --- | --- |
| Hover your palm over a hex | Picks the chord root (circle of fifths: C in the middle, G at the top) |
| Index finger up | Major |
| Index + middle up | Minor |
| Index + middle + ring up | Dominant 7th |
| Move up into the strip | **Power mode**: left–right picks the fret (0–12), upper half = root on low E, lower half = root on A |
| Drop back into the hex area | Back to **Chord mode** |

The chord you hover only *sounds* on your next strum — moving the left hand never changes a ringing
chord, exactly like a real guitar.

**Right hand (strum)**

| Do this | Result |
| --- | --- |
| Sweep down through the strings | Downstroke (strings sound top to bottom) |
| Sweep up | Upstroke |
| Faster | Louder and brighter |
| Open flat palm | Palm mute (short, dull notes) |
| Closed fist | Stop — silences every string |

**First run:** a 20-second calibration starts by itself once both hands are visible. Follow the
prompts (left hand roams its comfortable area, right hand strums its full range); the zones resize
to your reach. Redo it any time with **Calibrate**, cancel with **Esc**.

**Keyboard** (works with or without a camera — a full demo mode):

| Key | Action |
| --- | --- |
| `A`–`G` | Select chord (major) |
| `Shift` + `A`–`G` | Select minor chord |
| `Space` / `Shift`+`Space` | Strum down / up |
| `1` `2` `3` | Acoustic / Electric Clean / Electric Distortion |
| `I` | Cycle instrument |
| `Esc` | Cancel calibration |

**Panel (bottom corner):** instrument, volume, reverb, Calibrate, and **Settings** — left-handed mode
(mirrors everything: chords with the right hand), power chords with/without the octave, strum
threshold (ignore slow drifts), cursor smoothing, hex size, reset. Settings are saved in the browser.

Open the app with `?latency` (e.g. `http://localhost:5173/?latency`) to show a live latency readout.

---

## Setup

Tested on Linux with Chrome/Chromium. Needs a webcam, speakers, and an internet connection the first
time (MediaPipe's model and runtime load from a CDN, then the browser caches them).

### 1. Install the tools (once)

- **Node.js 22.12 or newer** and npm (the test runner requires it).
- **Rust** via [rustup](https://rustup.rs) (no sudo needed):
  ```sh
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  rustup target add wasm32-unknown-unknown
  ```
- **wasm-pack** (builds the engine):
  ```sh
  cargo install wasm-pack
  ```
  Make sure `~/.cargo/bin` is on your `PATH`.

### 2. Get the code and dependencies

```sh
git clone https://github.com/yoockh/strhapshody.git
cd strhapshody
npm install
```

### 3. Build the engine and run

```sh
npm run build:engine   # Rust → engine/pkg (WebAssembly). Re-run after changing engine/
npm run dev            # http://localhost:5173
```

Open the URL in Chrome or Edge, allow camera access, then click or press a key once so the browser
lets the page make sound.

### Production build

```sh
npm run build:engine
npm run build          # type-check + bundle into dist/
npm run preview        # serve dist/ at http://localhost:4173
```

`dist/` is a static site; any static host works (it must be served over `https://` or `localhost`
for camera access).

---

## Tests

| Command | What it runs |
| --- | --- |
| `npm run test:engine` | Rust unit tests (`cargo test` in `engine/`) — all engine logic and DSP, with synthetic inputs |
| `npm run test` | Vitest unit tests for the TypeScript logic |
| `npm run test:all` | Both of the above |
| `npm run test:e2e` | Playwright end-to-end: real Chromium with a fake camera, keyboard-driven, asserts real audio output; includes the latency harness |
| `npm run typecheck` | TypeScript type-check |

Before the first `test:e2e` on a machine: `npx playwright install chromium`. Details in
[`TESTING.md`](TESTING.md).

---

## Troubleshooting

- **"Camera unavailable"** — allow camera access for the site (address-bar camera icon), close other
  apps using the webcam, reload. You can keep playing with the keyboard meanwhile.
- **No hand skeleton appears** — MediaPipe couldn't download its model/runtime (offline or blocked
  network). The camera feed still shows; check the browser console for `hand tracking unavailable`.
- **No sound** — click or press a key once (browsers block audio until you interact), check the
  volume slider and system output.
- **`engine init failed: … WebAssembly.Table.set() … function-typed object`** in the console — the
  `wasm-opt` on your `PATH` is too old for this wasm-bindgen version (seen with binaryen 108). Remove
  it or install a newer one (`npm i -g binaryen`), then `npm run build:engine` again.
- **Chord and strum zones feel swapped** — MediaPipe's left/right labels depend on mirroring; if your
  real left hand drives the strings, flip the two values of `DEFAULT_HANDEDNESS_ROLE` in
  `src/handedness.ts` and tell us (it's on the checklist below). The *Left-handed* setting is for
  left-handed players, not for this.
- **`npm install` warns that esbuild's postinstall script was blocked** — harmless; Vite still finds
  its esbuild binary.

---

## Known limitations

- **Built and tested without a camera, hands or speakers.** All logic is unit-tested and the full
  browser/audio pipeline is exercised end-to-end through the keyboard, but tracking accuracy, gesture
  thresholds, strum feel, sound quality and real-hardware latency have not been tried by a person yet
  — that is what the checklist below is for. Every such item is logged in `DEVLOG.md` under "needs
  human verification".
- **Latency:** strum detection → sound measured at p50 43 ms / p95 51 ms in headless Chromium (fake
  audio device). With a camera, frame capture and hand-tracking inference add roughly 30–60 ms, which
  lands near the PRD's 100 ms target — measure it with `?latency`.
- MediaPipe assets come from a CDN, so the first run needs internet.
- Chrome/Edge are the target; Safari and Firefox are untested.
- Runs as a web page (`npm run dev` / static build); a native desktop wrapper (Tauri) is post-MVP.

---

## Manual test checklist (for Yaya, with a real webcam)

Run `npm run build:engine && npm run dev`, open `http://localhost:5173/?latency` in Chrome, sit at
your normal distance in decent light. Tick what works; note anything odd (append to `DEVLOG.md` or
just tell the next session).

**Camera & tracking**
- [ ] The feed is mirrored (raise your left hand — it appears on the left).
- [ ] The hand skeleton lands on your hands and follows them smoothly.
- [ ] Your **left** hand lights up the chord zone and your **right** hand the strum zone (if swapped,
      see Troubleshooting).
- [ ] TRACKING in the status bar says "OK · both hands" with both hands up.

**Calibration**
- [ ] On first load the 20 s calibration starts, the prompts are clear, and 8 s per hand is enough.
- [ ] Afterwards the hex flower and the strings sit where your hands comfortably reach.

**Chords (left hand)**
- [ ] Hovering each hex highlights it; a steady hand holds one chord, a deliberate move switches
      cleanly (no flicker on the borders).
- [ ] Index = major, index + middle = minor, three fingers = 7th — recognised reliably.
- [ ] Changing the chord while a strum rings does **not** change the sound until the next strum.
- [ ] The CHORD field matches what you hear.

**Strumming (right hand)**
- [ ] A normal down/up sweep sounds every string, in order, with few missed strums.
- [ ] Faster strums are louder; slow hand drifts across the strings don't pluck (adjust *Strum
      threshold* if they do, or if soft strums get lost).
- [ ] Open flat palm gives short muted notes; a fist silences everything.

**Power chords**
- [ ] Moving the left hand up into the strip switches MODE to Power without flickering.
- [ ] Left–right changes the fret, upper/lower half changes the string pair; the label reads like
      "G5 (fret 3, low E)" and matches what you hear.
- [ ] The power-chord strum feels tight and heavy (try Electric Dist), with and without the octave
      (Settings).

**Sound**
- [ ] Acoustic sounds like a plucked guitar; Electric Clean and Electric Dist sound right; loudness is
      balanced between them.
- [ ] Volume and Reverb sliders behave sensibly.

**Settings & warnings**
- [ ] Left-handed mode swaps everything and is playable with the opposite hands.
- [ ] Smoothing and Hex size feel right somewhere in their range; settings survive a reload.
- [ ] In a dim room a "Too dark" banner appears; a hand at the frame edge or out of view gets a
      banner; no banners flicker during normal play.

**Keyboard**
- [ ] `C`, `G`, `Shift+A`, `F` each followed by `Space` plays the chord.

**Latency** (the `?latency` readout, bottom-left — play ~30 strums with your hand)
- [ ] Note the numbers: `strum→sound p50 ___ / p95 ___ ms`, `camera→sound p50 ___ / p95 ___ ms`.
      Target: camera→sound p95 under 100 ms (ideally under 60). Does it *feel* immediate?

---

## Project layout

```
engine/            Rust → WebAssembly logic engine (cargo test)
  src/hexmap.rs        chord hex grid + hysteresis
  src/fingercount.rs   finger-count → chord quality
  src/chordlatch.rs    chord changes only on a strum
  src/strum.rs         string-crossing / direction / velocity
  src/gesture.rs       palm-mute / fist detection
  src/powerstrip.rs    power-chord strip geometry
  src/smoothing.rs     One Euro filter
  src/pluck.rs         Karplus-Strong string synthesis
  src/distortion.rs    waveshaper curve
  src/reverb.rs        reverb impulse response
src/               TypeScript app (Vite); *.test.ts = vitest
  main.ts              render loop and wiring
  audio.ts             Web Audio engine
  calibration.ts, settings.ts, warnings.ts, keyboard.ts, latency.ts, …
e2e/               Playwright end-to-end tests + latency harness
docs/PRD.md        product spec
```
