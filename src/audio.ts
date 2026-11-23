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
 * Instruments (task 5.2, ADR-0016): **acoustic** goes straight to the master
 * bus; **electric clean** and **electric distortion** share one chain —
 * `WaveShaperNode` (curve from the Rust `distortion` module, injected via
 * `setCurveGenerator`; drive 0 = identity = clean) → lowpass tone control →
 * level compensation → master. Electric plucks are brighter and sustain longer.
 *
 * After the instrument routes, a reverb send (task 5.3, ADR-0017) —
 * `ConvolverNode` with an impulse response synthesised by the Rust `reverb`
 * module (injected via `setImpulseGenerator`) — mixes wet/dry by
 * `reverbMix(amount)`, and the master gain follows `volumeToGain(volume)`.
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

/** The playable instruments (PRD §9). */
export type Instrument = "acoustic" | "clean" | "distortion";

/** Toggle order and status-bar names. */
export const INSTRUMENTS: readonly Instrument[] = ["acoustic", "clean", "distortion"];
export const INSTRUMENT_LABELS: Readonly<Record<Instrument, string>> = {
  acoustic: "Acoustic",
  clean: "Electric Clean",
  distortion: "Electric Dist",
};

/** Electric strings: brighter attack, longer sustain than the acoustic. */
const ELECTRIC_T60_AT_110 = 7;
const ELECTRIC_T60_MIN = 2.5;
const ELECTRIC_T60_MAX = 9;
const ELECTRIC_MAX_RENDER_S = 4.5;
const ELECTRIC_BRIGHTNESS_MIN = 0.6;
const ELECTRIC_BRIGHTNESS_MAX = 1;

/**
 * Karplus-Strong parameters for one pluck on `instrument`. Acoustic is
 * `acousticPluckParams`; both electric instruments use a brighter excitation
 * and a longer ring (T60 ∝ 1/√f clamped to [2.5, 9] s, rendered ≤ 4.5 s) —
 * the distortion itself is applied downstream, not here. Palm-muted plucks are
 * the same short thud on every instrument (on distortion that's the "chug").
 */
export function pluckParams(
  instrument: Instrument,
  freq: number,
  velocity: number,
  muted = false,
): AcousticPluckParams {
  if (instrument === "acoustic" || muted) return acousticPluckParams(freq, velocity, muted);
  const f = Number.isFinite(freq) && freq > 0 ? freq : 110;
  const v = Number.isFinite(velocity) && velocity > 0 ? velocity : 0;
  const t = Math.min(1, v / 3000);
  const brightness =
    ELECTRIC_BRIGHTNESS_MIN + (ELECTRIC_BRIGHTNESS_MAX - ELECTRIC_BRIGHTNESS_MIN) * t;
  const t60 = Math.min(
    ELECTRIC_T60_MAX,
    Math.max(ELECTRIC_T60_MIN, ELECTRIC_T60_AT_110 * Math.sqrt(110 / f)),
  );
  return { t60, brightness, duration: Math.min(t60, ELECTRIC_MAX_RENDER_S) };
}

/** Tone-control lowpass range, Hz. */
export const TONE_MIN_HZ = 700;
export const TONE_MAX_HZ = 12_000;

/**
 * Tone knob `[0, 1]` → lowpass cutoff in Hz, exponential (equal steps sound
 * equal): 0 → 700 Hz (dark), 1 → 12 kHz (open). Out-of-range / non-finite
 * input is clamped / treated as 0.5.
 */
export function toneToCutoff(tone: number): number {
  const t = Number.isFinite(tone) ? Math.min(1, Math.max(0, tone)) : 0.5;
  return TONE_MIN_HZ * Math.pow(TONE_MAX_HZ / TONE_MIN_HZ, t);
}

/**
 * Output gain that keeps the electric chain's loudness roughly constant as
 * drive rises (a saturated signal has far more RMS than a clean one at the
 * same peak): `1 / (1 + 12·drive)`, so clean = 1 and full drive ≈ 0.077. Tuned
 * in headless Chromium so the default distortion (drive 0.6) lands ~1.2× the
 * clean RMS — a touch louder, as a dirt channel should feel, not +7 dB.
 */
export function driveCompensation(drive: number): number {
  const d = Number.isFinite(drive) ? Math.min(1, Math.max(0, drive)) : 0;
  return 1 / (1 + 12 * d);
}

/** Default drive for the distortion instrument, and the tone default. */
export const DEFAULT_DRIVE = 0.6;
export const DEFAULT_TONE = 0.65;

/**
 * Builds a waveshaper curve (the engine's `distortionCurve`): table length and
 * drive in [0, 1] → `Float32Array` for `WaveShaperNode.curve`.
 */
export type CurveGenerator = (samples: number, drive: number) => Float32Array;

/** Master gain at full volume. Default volume 0.8 → 0.35 (the old fixed level). */
export const MAX_MASTER_GAIN = 0.55;
export const DEFAULT_VOLUME = 0.8;
export const DEFAULT_REVERB = 0.25;

/**
 * Volume slider `[0, 1]` → master gain, squared so the slider feels
 * perceptually even (loudness is roughly logarithmic in amplitude). 0 is
 * silence. Clamped; non-finite → the default volume.
 */
export function volumeToGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : DEFAULT_VOLUME;
  return MAX_MASTER_GAIN * v * v;
}

/**
 * Reverb amount `[0, 1]` → dry/wet gains. Dry eases down a little as wet comes
 * up so turning the reverb up doesn't just make everything louder; 0 is fully
 * dry. With the engine's unit-energy impulse response (ADR-0017) the wet level
 * is predictable. Clamped; non-finite → the default amount.
 */
export function reverbMix(amount: number): { dry: number; wet: number } {
  const a = Number.isFinite(amount) ? Math.min(1, Math.max(0, amount)) : DEFAULT_REVERB;
  return { dry: 1 - 0.3 * a, wet: 0.8 * a };
}

/**
 * Builds one reverb impulse-response channel (the engine's `reverbImpulse`):
 * sample rate, RT60 seconds, damping [0,1], seed → `Float32Array`.
 */
export type ImpulseGenerator = (
  sampleRate: number,
  duration: number,
  damping: number,
  seed: number,
) => Float32Array;

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
   * (px/s); `muted` plays it palm-muted (short, dark); `delay` (seconds,
   * default 0) schedules it on the audio clock, for sample-accurate rakes
   * (keyboard strum, task 6.4). Re-triggering a string stops its previous
   * voice first, like a real string that can only ring one note at a time.
   * Out-of-range indices are ignored.
   */
  pluck(index: number, velocity: number, muted?: boolean, delay?: number): void;
  /** Silence every ringing string immediately (fist-stop). */
  stopAll(): void;
  /** Switch instrument (new plucks use its voice; routing crossfades). */
  setInstrument(instrument: Instrument): void;
  /** The current instrument. */
  readonly instrument: Instrument;
  /** Distortion drive `[0, 1]` for the distortion instrument. */
  setDrive(drive: number): void;
  /** Electric tone `[0, 1]` (dark → bright). */
  setTone(tone: number): void;
  /**
   * Install the waveshaper curve generator. Until one is installed the shaper
   * has no curve (passes audio through), so electric sounds clean.
   */
  setCurveGenerator(generate: CurveGenerator | null): void;
  /** Master volume `[0, 1]`. */
  setVolume(volume: number): void;
  /** Reverb amount `[0, 1]` (0 = dry). */
  setReverb(amount: number): void;
  /**
   * Install the reverb impulse-response generator. Until one is installed the
   * convolver has no buffer (the wet path is silent).
   */
  setImpulseGenerator(generate: ImpulseGenerator | null): void;
  /**
   * Observability for tests / the latency harness (task 7.1/7.2): how many
   * voices have actually been started, and when the last one was scheduled.
   */
  readonly stats: { readonly voicesStarted: number; readonly lastVoiceTime: number };
  /** RMS of the master output over the last ~46 ms (an AnalyserNode tap). */
  outputLevel(): number;
  /** The note set currently loaded (Hz per string, 0 = silent string). */
  currentChord(): readonly number[];
  /** The underlying AudioContext's current time and output latency (seconds). */
  clock(): { readonly currentTime: number; readonly outputLatency: number; readonly baseLatency: number };
  /** Release the audio context and all voices. Idempotent. */
  close(): void;
}

/** Envelope constants for the placeholder (pre-wasm) oscillator pluck. */
const ATTACK_S = 0.004;
const DECAY_S = 1.4;
/** Level into the shaper: keeps six summed voices mostly inside [-1, 1]. */
const SHAPER_IN_GAIN = 0.3;
/** Waveshaper table length (odd → an exact entry at 0). */
const CURVE_SAMPLES = 2049;
/** Crossfade time constant when switching instruments, seconds. */
const ROUTE_TC_S = 0.01;
/** Reverb impulse response: RT60 seconds and tail damping. */
const REVERB_RT60_S = 2.2;
const REVERB_DAMPING = 0.6;

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

  // Master bus → speakers. Everything upstream lands in `mix`, which splits
  // into a dry path and a reverb send (convolver → wet), both into master.
  const master = ctx.createGain();
  let volume = DEFAULT_VOLUME;
  master.gain.value = volumeToGain(volume);
  master.connect(ctx.destination);
  // Level meter tap (observability only; doesn't affect the sound).
  const meter = ctx.createAnalyser();
  meter.fftSize = 2048;
  master.connect(meter);
  const meterBuf = new Float32Array(meter.fftSize);
  let voicesStarted = 0;
  let lastVoiceTime = 0;
  const mix = ctx.createGain();
  const dry = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.normalize = false; // the engine's IR is already unit-energy
  const wet = ctx.createGain();
  mix.connect(dry).connect(master);
  mix.connect(convolver).connect(wet).connect(master);
  let reverbAmount = DEFAULT_REVERB;
  const applyReverbMix = (immediate = false): void => {
    const { dry: d, wet: w } = reverbMix(reverbAmount);
    if (immediate) {
      dry.gain.value = d;
      wet.gain.value = w;
    } else {
      dry.gain.setTargetAtTime(d, ctx.currentTime, ROUTE_TC_S);
      wet.gain.setTargetAtTime(w, ctx.currentTime, ROUTE_TC_S);
    }
  };
  applyReverbMix(true);

  // Voices → bus, which feeds two routes (only one open at a time):
  //   acoustic: bus → acousticSend → master
  //   electric: bus → electricSend → shaper → tone → electricOut → master
  const bus = ctx.createGain();
  const acousticSend = ctx.createGain();
  const electricSend = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "4x";
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.Q.value = 0.7;
  const electricOut = ctx.createGain();
  bus.connect(acousticSend).connect(mix);
  bus.connect(electricSend).connect(shaper).connect(tone).connect(electricOut).connect(mix);

  let instrument: Instrument = "acoustic";
  let drive = DEFAULT_DRIVE;
  let toneValue = DEFAULT_TONE;
  let generateCurve: CurveGenerator | null = null;
  // Curve cache by quantised drive (regenerating is cheap but not free).
  const curveCache = new Map<number, Float32Array<ArrayBuffer>>();

  /** Drive actually applied by the shaper for the current instrument. */
  function activeDrive(): number {
    return instrument === "distortion" ? drive : 0;
  }

  function applyRouting(immediate = false): void {
    const now = ctx.currentTime;
    const electric = instrument !== "acoustic";
    const set = (p: AudioParam, v: number): void => {
      if (immediate) p.value = v;
      else p.setTargetAtTime(v, now, ROUTE_TC_S);
    };
    set(acousticSend.gain, electric ? 0 : 1);
    set(electricSend.gain, electric ? SHAPER_IN_GAIN : 0);
    set(electricOut.gain, driveCompensation(activeDrive()) / SHAPER_IN_GAIN);
    set(tone.frequency, toneToCutoff(toneValue));
    applyCurve();
  }

  function applyCurve(): void {
    const d = activeDrive();
    if (!generateCurve || d <= 0) {
      shaper.curve = null; // pass-through = clean
      return;
    }
    const key = Math.round(d * 100);
    let curve = curveCache.get(key);
    if (!curve) {
      try {
        const raw = generateCurve(CURVE_SAMPLES, key / 100);
        curve = new Float32Array(raw.length);
        curve.set(raw);
        curveCache.set(key, curve);
      } catch {
        shaper.curve = null;
        return;
      }
    }
    shaper.curve = curve;
  }
  applyRouting(true);

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
    const p = pluckParams(instrument, freq, velocity, muted);
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

    pluck(index: number, velocity: number, muted = false, delay = 0): void {
      if (closed) return;
      if (!Number.isInteger(index) || index < 0 || index >= voices.length) {
        return;
      }
      const freq = chord[index];
      if (freq === undefined || !Number.isFinite(freq) || freq <= 0) return;

      // Retrigger: stop whatever was ringing on this string.
      stopVoice(index);

      const now = ctx.currentTime + (Number.isFinite(delay) && delay > 0 ? delay : 0);
      const gain = ctx.createGain();
      const peak = velocityToGain(velocity);
      const source = karplusStrongSource(freq, velocity, muted, peak, gain, now)
        ?? oscillatorSource(freq, muted, peak, gain, now);

      gain.connect(bus);
      voicesStarted++;
      lastVoiceTime = now;
      const voice: Voice = { source, gain };
      voices[index] = voice;
      source.onended = () => {
        if (voices[index] === voice) voices[index] = null;
      };
    },

    stopAll(): void {
      for (let i = 0; i < voices.length; i++) stopVoice(i);
    },

    setInstrument(next: Instrument): void {
      if (!INSTRUMENTS.includes(next) || next === instrument) return;
      instrument = next;
      if (!closed) applyRouting();
    },

    get instrument(): Instrument {
      return instrument;
    },

    setDrive(value: number): void {
      if (!Number.isFinite(value)) return;
      drive = Math.min(1, Math.max(0, value));
      if (!closed) applyRouting();
    },

    setTone(value: number): void {
      if (!Number.isFinite(value)) return;
      toneValue = Math.min(1, Math.max(0, value));
      if (!closed) applyRouting();
    },

    get stats() {
      return { voicesStarted, lastVoiceTime };
    },

    outputLevel(): number {
      if (closed) return 0;
      meter.getFloatTimeDomainData(meterBuf);
      let sum = 0;
      for (let i = 0; i < meterBuf.length; i++) sum += meterBuf[i]! * meterBuf[i]!;
      return Math.sqrt(sum / meterBuf.length);
    },

    currentChord(): readonly number[] {
      return chord.slice();
    },

    clock() {
      return {
        currentTime: ctx.currentTime,
        outputLatency: (ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0,
        baseLatency: ctx.baseLatency ?? 0,
      };
    },

    setVolume(value: number): void {
      if (!Number.isFinite(value) || closed) return;
      volume = Math.min(1, Math.max(0, value));
      master.gain.setTargetAtTime(volumeToGain(volume), ctx.currentTime, ROUTE_TC_S);
    },

    setReverb(value: number): void {
      if (!Number.isFinite(value) || closed) return;
      reverbAmount = Math.min(1, Math.max(0, value));
      applyReverbMix();
    },

    setImpulseGenerator(generate: ImpulseGenerator | null): void {
      if (closed) return;
      if (!generate) {
        convolver.buffer = null;
        return;
      }
      try {
        const left = generate(ctx.sampleRate, REVERB_RT60_S, REVERB_DAMPING, 1);
        const right = generate(ctx.sampleRate, REVERB_RT60_S, REVERB_DAMPING, 2);
        const n = Math.min(left.length, right.length);
        if (n === 0) return;
        const ir = ctx.createBuffer(2, n, ctx.sampleRate);
        ir.getChannelData(0).set(left.subarray(0, n));
        ir.getChannelData(1).set(right.subarray(0, n));
        convolver.buffer = ir;
      } catch {
        convolver.buffer = null;
      }
    },

    setCurveGenerator(generate: CurveGenerator | null): void {
      generateCurve = generate;
      curveCache.clear();
      if (!closed) applyCurve();
    },

    close(): void {
      if (closed) return;
      closed = true;
      for (let i = 0; i < voices.length; i++) stopVoice(i);
      void ctx.close();
    },
  };
}
