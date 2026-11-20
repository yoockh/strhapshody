# Air Guitar App: Product Requirements Document

**Version:** 0.1 (Draft) | **Date:** Nov 20, 2026 | **Status:** For review by builder

## 1. Overview

A laptop app that turns your webcam into a playable guitar. The **left hand picks the chord** and the **right hand strums**, both tracked in the air with no hardware beyond a built-in webcam and speakers. It exists for one person who misses playing guitar and only has a laptop.

## 2. Goals and Non-Goals

**Goals**

- Feel like playing a guitar: strum direction, speed and rhythm all matter.
- Switch between the chords A to G quickly and reliably with one hand.
- Support power chords with a simple two-string layout.
- Sound good: acoustic and electric (clean and distorted).
- Run on an ordinary laptop with an ordinary webcam.

**Non-goals (v1)**

- Recording, multi-track, or song export.
- Lessons, tabs, or scoring.
- Mobile or tablet support.
- Full chord library (barre variations, jazz chords, etc.).

## 3. Target User

A single hobbyist guitarist playing at home on a laptop. Comfortable with chords and strumming, but has no guitar nearby. Primary need: jam along to songs and keep muscle memory and rhythm alive.

## 4. Platform Recommendation

**Build it as a web app that runs in the browser.** Reasons:

- Webcam access (`getUserMedia`), hand tracking (Google MediaPipe Hands, runs in-browser) and audio (Web Audio API) are all built in or freely available.
- No installer. Your friend can ship it as a link, and it works on Mac, Windows and Chromebook.
- Everything runs locally on the laptop, so no video leaves the machine.

A desktop wrapper (Electron/Tauri) can be added later if lower audio latency is needed.

## 5. Screen Layout

The mirrored webcam feed fills the screen, split into two zones. Mirroring matters, so your left hand appears on the left.

| Zone | Hand | Purpose |
| --- | --- | --- |
| Left half | Left hand | Chord selection (hex grid) and power chord strip |
| Right half | Right hand | Virtual strings for strumming |

A small status bar shows the current chord, mode (Chord / Power), instrument, and tracking health.

## 6. Left Hand: Chord Selection

### 6.1 Hexagonal chord map (A to G)

A hex "flower" of 7 cells fits the 7 letters exactly, one hex per chord:

- **Center:** C
- **Ring, clockwise from top:** G, D, A, E, B, F

The ring follows the circle of fifths, so neighbouring chords are the ones that most often follow each other in songs (C to G, G to D, D to A, and so on). Every chord is one move away from the center. The layout can be changed in settings.

**Selecting:** the cursor is the **palm center** (steadier than a fingertip). Moving the palm into a hex selects that chord and highlights it.

**Stability:**

- Hysteresis: the cursor must move a little past the border to switch, to prevent flicker between chords.
- Smoothing filter on hand position (e.g. One Euro filter).
- The chord only changes between strums, never mid-ring.

### 6.2 Chord quality via finger gestures

While hovering over a hex, the number of extended fingers sets the quality:

| Gesture | Quality | Example |
| --- | --- | --- |
| Index finger only | Major | C |
| Index + middle | Minor | Cm |
| Index + middle + ring | Dominant 7th | C7 |

v1 ships with Major and Minor as required, and 7th as a stretch goal.

## 7. Power Chords

A power chord is only the **root and fifth** (two strings, optionally the octave), so it doesn't need the hex map. Instead it uses a dedicated strip, where **position along the strip selects the fret and the strip's height selects the string pair**.

**Layout**

- A horizontal **Power Chord Strip** sits at the top of the left zone, above the hex grid.
- **Horizontal position = fret** (0 to 12), shown as fret markers. Moving right raises the pitch.
- **Height within the strip** selects the root string:
  - Upper half: root on the lowest-pitched string (6th/low E), fifth on the 5th string.
  - Lower half: root on the 5th string (A), fifth on the 4th string.
- Entering the strip switches the app to **Power mode**. Dropping the hand back into the hex area returns to **Chord mode**.

**Strumming in Power mode:** the right hand strums only the 2 relevant strings (plus an optional octave string), so the strum feels tight and heavy, as it should with distortion.

**Display:** the screen shows the current note names, e.g. "G5 (fret 3, low E)".

## 8. Right Hand: Strumming

Six horizontal virtual string lines are drawn across the right zone. The right hand tracks as a point (index fingertip or palm, user-selectable).

| Action | Result |
| --- | --- |
| Hand crosses strings moving **down** | Downstroke: strings sound top to bottom |
| Hand crosses strings moving **up** | Upstroke: strings sound bottom to top (usually lighter, higher strings emphasised) |
| Faster hand speed | Louder, with a tighter strum spread |
| Slower hand speed | Softer, with a more spread-out arpeggio feel |
| Open palm held flat over the strings | **Palm mute** (short, dull notes) |
| Closed fist | **Stop** (silences all strings) |

Timing: each string triggers at the moment the hand crosses its line, which gives the natural "rake" of a real strum.

## 9. Sound

**Instruments (v1, both required):**

- **Acoustic:** sampled or physically modelled steel-string guitar.
- **Electric:** clean tone, plus a distortion mode with a drive amount (built with a Web Audio waveshaper) and basic tone control.

An instrument toggle is available on screen and via a keyboard shortcut. Each string is a separate voice so chords ring and overlap naturally, and the same chord shape feeds both instruments.

Volume and a simple reverb amount are adjustable.

## 10. Performance and Quality Requirements

| Requirement | Target |
| --- | --- |
| Hand tracking frame rate | At least 30 FPS (60 preferred) on a typical laptop |
| Strum-to-sound latency | Under 100 ms (under 60 ms ideal) |
| Chord switch accuracy | At least 95% correct selection when cursor is deliberately in a hex |
| Missed strums | Under 5% at moderate strum speed |
| Runs on | Recent Chrome, Edge and Safari on laptop-class hardware |
| Privacy | All video processed locally; nothing uploaded or stored |

## 11. Setup, Calibration and Settings

- **First-run calibration (about 20 seconds):** hold each hand up so the app learns your comfortable range and sizes the zones to match.
- **Handedness swap** for left-handed players.
- **Sensitivity sliders:** strum threshold, smoothing, hex size.
- **Camera guidance:** a gentle warning if lighting is poor or a hand leaves the frame.
- **Keyboard fallback:** number keys or letters A to G select chords, and spacebar strums. This also doubles as a debugging mode.

## 12. MVP Scope and Milestones

**MVP (must have)**

1. Webcam capture with both hands tracked.
2. Right-hand strum detection with up and down direction and velocity.
3. Hex map for A to G major, plus minor via finger gesture.
4. Power chord strip with fret and string-pair selection.
5. Acoustic and electric (clean and distorted) sounds.
6. Calibration and basic settings.

**Suggested build order**

- **Week 1:** Hand tracking prototype and on-screen cursors.
- **Week 2:** Strum detection plus single-chord audio.
- **Week 3:** Hex map, chord switching and quality gestures.
- **Week 4:** Power chord strip, distortion, polish and latency tuning.

**Later (post-v1):** 7th and other chord types, metronome and backing tracks, recording, custom chord layouts, more instruments.

## 13. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Webcam tracking jitter causes wrong chords | Smoothing, hysteresis, larger hex cells |
| Hands occlude each other or leave frame | Zone separation, on-screen warnings |
| Latency feels laggy for rhythm playing | Prioritise low-latency audio path and measure early |
| Left and right hands confused when crossing | Use MediaPipe handedness plus screen-side assignment as backup |
| Poor lighting | Setup check and tips |
| Arm fatigue from playing in the air | Keep the play area compact and near the chest; add a rest hint |

## 14. Success Metrics

- Can play a simple 4-chord song (e.g. C, G, Am, F) in time within 10 minutes of first use.
- Strum-to-sound latency under 100 ms measured on the target laptop.
- Subjective check: you want to keep playing after 30 minutes.

## 15. Open Questions (resolved by builder, see DECISIONS.md)

1. Power chord strings, hex layout order, minor-gesture comfort, target laptop, and who builds it — all resolved pragmatically in DECISIONS.md since no further input was available; defaults from this PRD were kept as-is (circle-of-fifths hex, lowest two strings as default power pair, finger-count gestures, laptop-class Chrome target, built by an autonomous coding agent).
