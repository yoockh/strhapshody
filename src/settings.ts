/**
 * User settings (task 6.2): handedness swap, sensitivity sliders (strum
 * threshold, smoothing, hex size), plus the sound controls from 5.3 and the
 * power-chord octave toggle from 4.3 — all persisted in localStorage.
 *
 * Pure and unit-tested (ADR-0002): the settings shape and defaults,
 * `validateSettings` (field-by-field merge with defaults, so one bad or
 * missing field from an older build never resets the rest), and the slider →
 * engine-parameter mappings. The panel UI lives in `controls.ts`; `main.ts`
 * applies the values.
 *
 * Sliders are stored as 0..1 knob positions (what the user sees), and mapped
 * to engine units here, so the units can be retuned without breaking saved
 * settings.
 */

import { DEFAULT_REVERB, DEFAULT_VOLUME, INSTRUMENTS, type Instrument } from "./audio.ts";

export const SETTINGS_STORAGE_KEY = "strhapshody.settings.v1";

export interface Settings {
  /** Chord with the right hand, strum with the left (PRD §11 handedness swap). */
  readonly leftHanded: boolean;
  /** Strum threshold knob [0,1]: higher ignores slower hand movement. */
  readonly strumThreshold: number;
  /** Chord-cursor smoothing knob [0,1]: higher = steadier but laggier. */
  readonly smoothing: number;
  /** Hex size knob [0,1]: 0 = smallest flower, 1 = largest that fits. */
  readonly hexSize: number;
  /** Power chords add the octave as a third string (ADR-0014). */
  readonly powerOctave: boolean;
  readonly instrument: Instrument;
  readonly volume: number;
  readonly reverb: number;
}

export const DEFAULT_SETTINGS: Settings = {
  leftHanded: false,
  strumThreshold: 0.3,
  smoothing: 0.45,
  hexSize: 1,
  powerOctave: true,
  instrument: "acoustic",
  volume: DEFAULT_VOLUME,
  reverb: DEFAULT_REVERB,
};

const unit = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/**
 * Settings from stored JSON: every valid field is kept, every missing or
 * invalid one falls back to its default (numbers are clamped to [0,1]).
 * Non-objects yield the defaults. Never throws, never returns null.
 */
export function validateSettings(raw: unknown): Settings {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    leftHanded: bool(r.leftHanded, d.leftHanded),
    strumThreshold: unit(r.strumThreshold, d.strumThreshold),
    smoothing: unit(r.smoothing, d.smoothing),
    hexSize: unit(r.hexSize, d.hexSize),
    powerOctave: bool(r.powerOctave, d.powerOctave),
    instrument: INSTRUMENTS.includes(r.instrument as Instrument)
      ? (r.instrument as Instrument)
      : d.instrument,
    volume: unit(r.volume, d.volume),
    reverb: unit(r.reverb, d.reverb),
  };
}

/**
 * Strum threshold knob → the strum detector's minimum crossing speed in px/s
 * for a canvas `height` px tall: `2 · height · t²` (screen heights per
 * second, squared so the low end is fine-grained). 0 → every crossing
 * counts; default 0.3 on a 720 px canvas ≈ 130 px/s, well under a real strum
 * (~2000+ px/s) but above a hand drifting across the strings.
 */
export function strumMinVelocity(threshold: number, height: number): number {
  const t = unit(threshold, DEFAULT_SETTINGS.strumThreshold);
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  return 2 * h * t * t;
}

/** One Euro `min_cutoff` (Hz) at the light / heavy ends of the smoothing knob. */
export const SMOOTHING_LIGHT_HZ = 5;
export const SMOOTHING_HEAVY_HZ = 0.3;

/**
 * Smoothing knob → One Euro `min_cutoff` (Hz), exponential from 5 Hz (light,
 * responsive) to 0.3 Hz (heavy, steady). The default 0.45 ≈ 1.4 Hz, close to
 * the 1.5 Hz the cursor used before this setting existed (ADR-0006).
 */
export function smoothingMinCutoff(smoothing: number): number {
  const s = unit(smoothing, DEFAULT_SETTINGS.smoothing);
  return SMOOTHING_LIGHT_HZ * Math.pow(SMOOTHING_HEAVY_HZ / SMOOTHING_LIGHT_HZ, s);
}

/** Smallest hex flower as a fraction of the largest that fits. */
export const MIN_HEX_SCALE = 0.6;

/** Hex size knob → radius scale in [0.6, 1] of the largest flower that fits. */
export function hexScale(hexSize: number): number {
  const s = unit(hexSize, DEFAULT_SETTINGS.hexSize);
  return MIN_HEX_SCALE + (1 - MIN_HEX_SCALE) * s;
}
