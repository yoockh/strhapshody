/**
 * Web Audio engine skeleton (task 2.4 / PRD §9).
 *
 * Six string voices, one hardcoded test chord, and a simple plucked-string
 * synth triggered by the strum events produced by the Rust `strum` module
 * (task 2.2). The timbre here is a deliberate placeholder — the real acoustic
 * (Karplus-Strong) and electric/distortion voices arrive in Phase 5. The point
 * of this task is the *wiring*: a strum crossing a string line makes that
 * string sound, at a loudness set by the crossing velocity.
 *
 * ADR-0002 split: the one piece of pure, camera/DOM-free logic — mapping a
 * strum velocity (px/s) to a voice gain — is `velocityToGain`, exported and
 * unit-tested. Everything else needs a live `AudioContext` (no audio hardware
 * in this execution environment), so it's a thin wrapper exercised by the
 * Playwright e2e suite (task 7.1) and a human, not vitest. No DOM/Web-Audio
 * symbol is touched at module load, so importing this file under node (to test
 * `velocityToGain`) is safe.
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

/** A single live plucked-string voice (oscillator + its envelope gain). */
interface Voice {
  readonly osc: OscillatorNode;
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
   * Future chord-change wiring (task 3.4) calls this on a strum boundary.
   */
  setChord(frequencies: readonly number[]): void;
  /**
   * Pluck string `index` (0 = top = low E) at the given strum `velocity`
   * (px/s). Re-triggering a string stops its previous voice first, like a real
   * string that can only ring one note at a time. Out-of-range indices are
   * ignored.
   */
  pluck(index: number, velocity: number): void;
  /** Silence every ringing string immediately (fist-stop, task 2.3 → Phase). */
  stopAll(): void;
  /** Release the audio context and all voices. Idempotent. */
  close(): void;
}

/** Envelope / timbre constants for the placeholder pluck. */
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

  function stopVoice(index: number): void {
    const v = voices[index];
    if (!v) return;
    const now = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      // Fast fade to avoid a click, then stop.
      v.gain.gain.setValueAtTime(Math.max(v.gain.gain.value, 0.0001), now);
      v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);
      v.osc.stop(now + 0.02);
    } catch {
      // Already stopped / scheduling race — ignore.
    }
    voices[index] = null;
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
    },

    pluck(index: number, velocity: number): void {
      if (closed) return;
      if (!Number.isInteger(index) || index < 0 || index >= voices.length) {
        return;
      }
      const freq = chord[index];
      if (freq === undefined || !Number.isFinite(freq) || freq <= 0) return;

      // Retrigger: stop whatever was ringing on this string.
      stopVoice(index);

      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "triangle"; // placeholder timbre (Phase 5 replaces this)
      osc.frequency.setValueAtTime(freq, now);

      const gain = ctx.createGain();
      const peak = velocityToGain(velocity);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak, now + ATTACK_S);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + DECAY_S);

      osc.connect(gain);
      gain.connect(master);
      osc.start(now);
      osc.stop(now + DECAY_S + 0.05);

      const voice: Voice = { osc, gain };
      voices[index] = voice;
      osc.onended = () => {
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
