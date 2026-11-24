/**
 * Keyboard fallback (task 6.4 / PRD §11): play without a camera.
 *
 * - `A`–`G` select the chord root (major); hold **Shift** for minor
 *   (`Shift+A` = Am). Holding rather than a sticky toggle, because Shift is
 *   also the upstroke modifier — a toggle would flip on every upstroke.
 * - **Space** strums down, **Shift+Space** strums up.
 *
 * The chord goes into the same chord latch as the hand path and only sounds on
 * the next strum (ADR-0012), and the strum is a synthetic rake across the six
 * strings — so this doubles as a deterministic demo / debug / e2e-test driver
 * for the whole chord → voicing → audio pipeline (task 7.1).
 *
 * Pure and unit-tested (ADR-0002): key → action mapping and the rake
 * schedule. `main.ts` wires the listener.
 */

import { QUALITY_MAJOR, QUALITY_MINOR } from "./chords.ts";
import { STRING_COUNT } from "./strings.ts";

export type ChordLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type KeyAction =
  | { readonly kind: "chord"; readonly root: ChordLetter; readonly quality: number }
  | { readonly kind: "strum"; readonly direction: "down" | "up" };

/** The parts of a `KeyboardEvent` the mapping reads. */
export interface KeyInput {
  readonly key: string;
  readonly code?: string;
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly altKey?: boolean;
  readonly repeat?: boolean;
}

const LETTERS: readonly string[] = ["A", "B", "C", "D", "E", "F", "G"];

/**
 * The fallback action for a key press, or `null` if the key isn't one.
 * Ctrl/Meta/Alt chords and auto-repeat are ignored (holding Space must not
 * machine-gun strums; browser shortcuts keep working).
 */
export function keyAction(e: KeyInput): KeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return null;
  if (e.key === " " || e.code === "Space") {
    return { kind: "strum", direction: e.shiftKey ? "up" : "down" };
  }
  const letter = e.key.length === 1 ? e.key.toUpperCase() : "";
  if (LETTERS.includes(letter)) {
    return {
      kind: "chord",
      root: letter as ChordLetter,
      quality: e.shiftKey ? QUALITY_MINOR : QUALITY_MAJOR,
    };
  }
  return null;
}

/** One scheduled pluck of a synthetic strum. */
export interface RakeStep {
  /** String index, 0 = low E (top). */
  readonly string: number;
  /** Seconds after the strum starts. */
  readonly delay: number;
  /** Strum speed (px/s) handed to the audio engine's velocity mapping. */
  readonly velocity: number;
}

/** Gap between consecutive strings in a synthetic strum, seconds. */
export const RAKE_SECONDS = 0.012;
/** Synthetic downstroke speed (px/s): a firm, not maximal, strum. */
export const KEYBOARD_STRUM_VELOCITY = 2200;
/** Upstrokes are lighter (PRD §8). */
export const UPSTROKE_FACTOR = 0.75;

/**
 * The rake for a synthetic strum: all six strings, top→bottom on a downstroke
 * and bottom→top on an upstroke (PRD §8 "the natural rake of a real strum"),
 * `RAKE_SECONDS` apart; upstrokes lighter.
 */
export function rakeSchedule(direction: "down" | "up"): RakeStep[] {
  const velocity =
    direction === "up" ? KEYBOARD_STRUM_VELOCITY * UPSTROKE_FACTOR : KEYBOARD_STRUM_VELOCITY;
  const steps: RakeStep[] = [];
  for (let n = 0; n < STRING_COUNT; n++) {
    const string = direction === "down" ? n : STRING_COUNT - 1 - n;
    steps.push({ string, delay: n * RAKE_SECONDS, velocity });
  }
  return steps;
}

/** One-line key reference for on-screen hints. */
export const KEYBOARD_HELP =
  "Keys: A–G chord · Shift+letter minor · Space strum down · Shift+Space up · 1/2/3 instrument";
