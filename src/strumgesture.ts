/**
 * Right-hand shape → audio behaviour (PRD §8, wiring the task-2.3 engine
 * `GestureDetector` into the strum path).
 *
 * The engine classifies the strumming hand each frame (debounced) as Neutral,
 * OpenPalm or Fist (ADR-0008). This module decides what that means for sound:
 *
 * - **Fist = stop.** Entering a fist silences every ringing string, and while
 *   the fist is held string crossings don't pluck — so the stop sticks even if
 *   the closed hand drifts across the strings.
 * - **Open palm = palm mute.** Crossings pluck short, dark notes
 *   (`acousticPluckParams(…, muted)`); strings already ringing are left alone.
 * - **Neutral** = normal strumming.
 *
 * Pure and node-testable (ADR-0002): shapes are the engine's `HandShape`
 * integer values, mirrored below so no wasm import is needed.
 */

/** `HandShape` integer values — must match `engine/src/gesture.rs`. */
export const SHAPE_NEUTRAL = 0;
export const SHAPE_OPEN_PALM = 1;
export const SHAPE_FIST = 2;

/** What the strum path should do this frame for the current hand shape. */
export interface StrumGestureAction {
  /** Silence every ringing string now (just closed into a fist). */
  readonly stopAll: boolean;
  /** Don't pluck any crossings this frame. */
  readonly suppressPlucks: boolean;
  /** Pluck crossings palm-muted. */
  readonly muted: boolean;
}

/**
 * Action for a frame where the debounced shape went from `previous` to
 * `current`. Only the *transition into* a fist triggers `stopAll`, so holding a
 * fist doesn't re-stop every frame. Unknown shape values behave as Neutral.
 */
export function strumGestureAction(previous: number, current: number): StrumGestureAction {
  const fist = current === SHAPE_FIST;
  return {
    stopAll: fist && previous !== SHAPE_FIST,
    suppressPlucks: fist,
    muted: current === SHAPE_OPEN_PALM,
  };
}

/**
 * Status-bar MODE text: the play mode plus the right-hand modifier when one is
 * active, e.g. `"Chord"`, `"Power · palm mute"`, `"Chord · stop"`.
 */
export function modeLabel(mode: "Chord" | "Power", shape: number): string {
  if (shape === SHAPE_OPEN_PALM) return `${mode} · palm mute`;
  if (shape === SHAPE_FIST) return `${mode} · stop`;
  return mode;
}
