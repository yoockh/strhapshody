/**
 * Web Audio engine (task 2.4 skeleton, task 5.1 acoustic voice / PRD §9).
 *
 * Six string voices triggered by the strum events produced by the Rust `strum`
 * module (task 2.2). Each pluck is a **Karplus-Strong** buffer rendered by the
 * Rust `pluck` module (task 5.1, ADR-0015) and played through an
 * `AudioBufferSourceNode`; the renderer is *injected* (`setPluckRenderer`) so
 * this file never imports wasm and the engine can start before the wasm has
 * loaded — until then, or if a render fails, a triangle-oscillator placeholder
 * pluck keeps the instrument playable.
 *
 * ADR-0002 split: the pure, camera/DOM-free logic — strum velocity → gain
 * (`velocityToGain`) and the per-note Karplus-Strong parameters
 * (`acousticPluckParams`: ring time by pitch, brightness by velocity, palm-mute
 * damping) — is exported and unit-tested. Everything else needs a live
 * `AudioContext` (no audio hardware in this execution environment), so it's a
 * thin wrapper exercised by the Playwright e2e suite (task 7.1) and a human,
 * not vitest. No DOM/Web-Audio symbol is touched at module load, so importing
 * this file under node is safe.
 */

import { TEST_CHORD_FREQUENCIES } from "./notes.ts";

/** Tunables for the strum-velocity → gain mapping. */
export interface VelocityGainOptions {
  /** Velocity (px/s) at/above which the voice plays at full `maxGain`. */
  readonly refVelocity?: number;
  /** Floor gain for the gentlest audible strum (velocity → 0⁺). */
  readonly minGain?: number;
  /** Peak gain for a full-speed strum. */
  readonly maxGain?: number;
}

/**
 * Map a strum crossing velocity (|Δy|/Δt in px/s, from the `strum` module) to a
 * per-voice linear gain in `[minGain, maxGain]`. The response is linear in
 * velocity up to `refVelocity`, then saturates, so hard strums don't clip
 * harder and harder. A non-finite or non-positive velocity yields `minGain`
 * (still audible — a crossing happened), never 0 or NaN.
 */
export function velocityToGain(
  velocity: number,
  opts: VelocityGainOptions = {},
): number {
  const refVelocity = opts.refVelocity ?? 3000;
  const minGain = opts.minGain ?? 0.08;
  const maxGain = opts.maxGain ?? 1;

  if (!Number.isFinite(velocity) || velocity <= 0) return minGain;
  const t = Math.min(1, velocity / refVelocity);
  return minGain + (maxGain - minGain) * t;
}

/**
 * Renders a Karplus-Strong pluck (the engine's `renderPluck`): frequency (Hz),
 * sample rate (Hz), duration (s), T60 ring time (s), brightness [0,1], seed.
 * An empty array means "can't render this note".
 */
export type PluckRenderer = (
  freq: number,
  sampleRate: number,
  duration: number,
  t60: number,
  brightness: number,
  seed: number,
) => Float32Array;

/** Karplus-Strong parameters for one acoustic pluck (see `acousticPluckParams`). */
export interface AcousticPluckParams {
  /** Seconds for the note to fall 60 dB. */
  readonly t60: number;
  /** Excitation brightness in [0, 1]. */
  readonly brightness: number;
  /** Buffer length to render, seconds (≤ t60; the buffer fades out). */
  readonly duration: number;
}

/** Ring time of an open A (110 Hz) string, seconds; scales with pitch. */
const ACOUSTIC_T60_AT_110 = 4.5;
const ACOUSTIC_T60_MIN = 1.2;
const ACOUSTIC_T60_MAX = 6;
/** Palm-muted notes: a short thud (PRD §8 "short, dull notes"). */
const MUTED_T60 = 0.18;
/** Longest buffer rendered per pluck — later decay is inaudible under a strum. */
const MAX_RENDER_S = 3.5;
/** Excitation brightness range mapped from strum velocity. */
const BRIGHTNESS_MIN = 0.35;
const BRIGHTNESS_MAX = 0.95;

/**
 * Karplus-Strong parameters for an acoustic pluck at `freq` Hz, strummed at
 * `velocity` px/s. Lower strings ring longer (T60 ∝ 1/√f, clamped to
 * [1.2, 6] s — ~5 s on low E, ~2.6 s on high e, as on a real acoustic); a
 * harder strum is brighter (velocity → brightness, same reference speed as
 * `velocityToGain`); a palm-muted pluck is short and dark. Total for any
 * input — bad numbers fall back to sane values, never NaN.
 */
export function acousticPluckParams(
  freq: number,
  velocity: number,
  muted = false,
): AcousticPluckParams {
  const f = Number.isFinite(freq) && freq > 0 ? freq : 110;
  const v = Number.isFinite(velocity) && velocity > 0 ? velocity : 0;
  const t = Math.min(1, v / 3000);
  const bright = BRIGHTNESS_MIN + (BRIGHTNESS_MAX - BRIGHTNESS_MIN) * t;
  if (muted) {
    return { t60: MUTED_T60, brightness: bright * 0.5, duration: MUTED_T60 * 1.5 };
  }
  const t60 = Math.min(
    ACOUSTIC_T60_MAX,
    Math.max(ACOUSTIC_T60_MIN, ACOUSTIC_T60_AT_110 * Math.sqrt(110 / f)),
  );
  return { t60, brightness: bright, duration: Math.min(t60, MAX_RENDER_S) };
}

/** A single live plucked-string voice (source + its gain). */
interface Voice {
  readonly source: AudioScheduledSourceNode;
  readonly gain: GainNode;
}

/** Public handle onto the audio engine (consumed by the render loop). */
export interface AudioEngine {
  /**
   * Resume the underlying `AudioContext`. Browsers start it suspended until a
   * user gesture, so call this from a one-time pointer/key handler. Safe to
   * call repeatedly. Resolves once running (or immediately if already).
   */
  resume(): Promise<void>;
  /** Whether the context is currently running (audible). */
  readonly running: boolean;
  /**
   * Replace the sounding note set — one frequency (Hz) per string, top→bottom.
   * Called on a strum boundary when the sounding voicing changes. A
   * non-positive frequency marks a string as not sounded (it is damped now and
   * ignored by `pluck`), which is how power chords restrict the strum to 2–3
   * strings (task 4.3).
   */
  setChord(frequencies: readonly number[]): void;
  /**
   * Install (or clear, with `null`) the Karplus-Strong renderer. Until one is
   * installed plucks use the placeholder oscillator voice.
   */
  setPluckRenderer(render: PluckRenderer | null): void;
  /**
   * Pluck string `index` (0 = top = low E) at the given strum `velocity`
   * (px/s); `muted` plays it palm-muted (short, dark). Re-triggering a string
   * stops its previous voice first, like a real string that can only ring one
   * note at a time. Out-of-range indices are ignored.
   */
  pluck(index: number, velocity: number, muted?: boolean): void;
  /** Silence every ringing string immediately (fist-stop, task 2.3 → Phase). */
  stopAll(): void;
  /** Release the audio context and all voices. Idempotent. */
  close(): void;
}

/** Envelope constants for the placeholder (pre-wasm) oscillator pluck. */
const ATTACK_S = 0.004;
const DECAY_S = 1.4;
const MASTER_GAIN = 0.35;

/**
 * Create the Web Audio engine. Constructs a (suspended) `AudioContext`; nothing
 * sounds until `resume()` is called from a user gesture. Throws if the browser
 * has no Web Audio support — the caller logs and runs on without audio.
 */
export function createAudioEngine(): AudioEngine {
  const Ctor: typeof AudioContext | undefined =
    typeof AudioContext !== "undefined"
      ? AudioContext
      : (globalThis as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio API not available");

  const ctx = new Ctor();

  // Master bus: all voices → master gain → speakers.
  const master = ctx.createGain();
  master.gain.value = MASTER_GAIN;
  master.connect(ctx.destination);

  let chord: number[] = [...TEST_CHORD_FREQUENCIES];
  // One active voice slot per string; a new pluck replaces the old one.
  const voices: (Voice | null)[] = chord.map(() => null);
  let closed = false;
  let renderPluck: PluckRenderer | null = null;
  let seed = 1;

  function stopVoice(index: number): void {
    const v = voices[index];
    if (!v) return;
    const now = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      // Fast fade to avoid a click, then stop.
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      v.source.stop(now + 0.02);
    } catch {
      // Already stopped / scheduling race — ignore.
    }
    voices[index] = null;
  }

  /** Karplus-Strong voice from the injected renderer, or null to fall back. */
  function karplusStrongSource(
    freq: number,
    velocity: number,
    muted: boolean,
    peak: number,
    gain: GainNode,
    now: number,
  ): AudioScheduledSourceNode | null {
    if (!renderPluck) return null;
    const p = acousticPluckParams(freq, velocity, muted);
    let samples: Float32Array;
    try {
      seed = (seed + 1) >>> 0 || 1;
      samples = renderPluck(freq, ctx.sampleRate, p.duration, p.t60, p.brightness, seed);
    } catch {
      return null;
    }
    if (samples.length === 0) return null;
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    buffer.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    gain.gain.setValueAtTime(peak, now);
    src.connect(gain);
    src.start(now);
    return src;
  }

  /** Placeholder triangle-oscillator pluck (before the wasm renderer loads). */
  function oscillatorSource(
    freq: number,
    muted: boolean,
    peak: number,
    gain: GainNode,
    now: number,
  ): AudioScheduledSourceNode {
    const decay = muted ? MUTED_T60 : DECAY_S;
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + decay + 0.05);
    return osc;
  }

  return {
    async resume(): Promise<void> {
      if (closed) return;
      if (ctx.state !== "running") await ctx.resume();
    },

    get running(): boolean {
      return !closed && ctx.state === "running";
    },

    setChord(frequencies: readonly number[]): void {
      chord = frequencies.slice(0, voices.length).map((f) => f);
      // A string the new voicing doesn't sound (muted in the chord shape, or
      // outside a power chord's 2–3 strings) is damped, like a guitarist's
      // fretting hand muting it on the change — otherwise a low E left ringing
      // from the previous chord would bleed under e.g. a C or an A5.
      for (let i = 0; i < voices.length; i++) {
        const f = chord[i];
        if (f === undefined || !Number.isFinite(f) || f <= 0) stopVoice(i);
      }
    },

    setPluckRenderer(render: PluckRenderer | null): void {
      renderPluck = render;
    },

    pluck(index: number, velocity: number, muted = false): void {
      if (closed) return;
      if (!Number.isInteger(index) || index < 0 || index >= voices.length) {
        return;
      }
      const freq = chord[index];
      if (freq === undefined || !Number.isFinite(freq) || freq <= 0) return;

      // Retrigger: stop whatever was ringing on this string.
      stopVoice(index);

      const now = ctx.currentTime;
      const gain = ctx.createGain();
      const peak = velocityToGain(velocity);
      const source = karplusStrongSource(freq, velocity, muted, peak, gain, now)
        ?? oscillatorSource(freq, muted, peak, gain, now);

      gain.connect(master);
      const voice: Voice = { source, gain };
      voices[index] = voice;
      source.onended = () => {
        if (voices[index] === voice) voices[index] = null;
      };
    },

    stopAll(): void {
      for (let i = 0; i < voices.length; i++) stopVoice(i);
    },

    close(): void {
      if (closed) return;
      closed = true;
      for (let i = 0; i < voices.length; i++) stopVoice(i);
      void ctx.close();
    },
  };
}
