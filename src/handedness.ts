/**
 * Handedness assignment (task 1.2).
 *
 * Pure, unit-tested logic that decides which detected hand drives chords (the
 * left zone) and which drives strumming (the right zone), per PRD §5 and the
 * §13 risk mitigation ("Use MediaPipe handedness plus screen-side assignment as
 * backup"). Two signals, in that priority order:
 *
 *  1. MediaPipe handedness (PRIMARY). Because we feed the RAW, unmirrored camera
 *     frame to MediaPipe (see handtracking.ts) while the *display* is mirrored,
 *     MediaPipe's "Left"/"Right" labels are relative to a mirrored image and
 *     must be swapped to recover the user's actual hand — MediaPipe documents
 *     this ("swap the handedness output" when the input is not mirrored). The
 *     resulting user-hand → role mapping lives in DEFAULT_HANDEDNESS_ROLE and is
 *     overridable in one place if it ever proves backwards on real hardware
 *     (flagged for human verification in DEVLOG — there's no camera here).
 *
 *  2. Screen-side position (BACKUP). Unambiguous and matches §5 exactly ("your
 *     left hand appears on the left"): the hand further to the screen-left
 *     controls chords, the other strums. Used whenever handedness is
 *     unreliable — a label below the confidence threshold, or both hands
 *     reporting the same label (the classic failure mode when hands cross).
 *
 * This module is deliberately MediaPipe-free (plain Point2D arrays) so it runs
 * under vitest without the WASM runtime — the ADR-0002 split, same as
 * handoverlay.ts.
 */

import type { Point2D } from "./handoverlay.ts";

export type Handedness = "Left" | "Right";
export type HandRole = "chord" | "strum";

/**
 * User-hand → role mapping, for RAW (unmirrored) frames fed to MediaPipe with a
 * mirrored display. MediaPipe's label is relative to a mirrored image, so it is
 * swapped to recover the user's real hand:
 *   - MediaPipe "Right" → user's LEFT hand  → chords (left zone)
 *   - MediaPipe "Left"  → user's RIGHT hand → strum  (right zone)
 * If this turns out backwards on real hardware, flip these two values — it's the
 * single point of truth for the mirror convention.
 */
export const DEFAULT_HANDEDNESS_ROLE: Readonly<Record<Handedness, HandRole>> = {
  Right: "chord",
  Left: "strum",
};

/** `DEFAULT_HANDEDNESS_ROLE` with the roles swapped, for left-handed players. */
export const LEFT_HANDED_ROLE: Readonly<Record<Handedness, HandRole>> = {
  Right: "strum",
  Left: "chord",
};

/** One detected hand's inputs to the assignment. */
export interface RawHand {
  readonly handedness: Handedness;
  /** Confidence [0,1] of the handedness label. */
  readonly score: number;
  /** Normalized landmarks (x,y in [0,1] relative to the video frame). */
  readonly landmarks: ReadonlyArray<Point2D>;
}

/** Result of assigning one hand to a role. */
export interface AssignedHand {
  /** Index back into the input `hands` array. */
  readonly index: number;
  readonly role: HandRole;
  readonly handedness: Handedness;
  readonly score: number;
  /** Representative x in [0,1] after mirroring (0 = screen-left edge). */
  readonly screenX: number;
  /** Which signal decided this assignment. */
  readonly source: "handedness" | "screen-side";
}

export interface AssignOptions {
  /** Below this handedness score, fall back to screen-side. Default 0.6. */
  readonly minScore?: number;
  /** Whether the display is mirrored (PRD §5). Default true. */
  readonly mirror?: boolean;
  /** Override the user-hand → role mapping (see DEFAULT_HANDEDNESS_ROLE). */
  readonly roleMap?: Readonly<Record<Handedness, HandRole>>;
  /**
   * Left-handed player (settings, task 6.2): the user's RIGHT hand picks
   * chords and the LEFT hand strums, so the default role map is swapped and the
   * screen-side fallback puts chords on the right half. An explicit `roleMap`
   * still wins for the label mapping.
   */
  readonly leftHanded?: boolean;
}

/**
 * Representative normalized x of a hand: the mean of the wrist (landmark 0) and
 * the middle-finger MCP (landmark 9), i.e. roughly the palm centre, which is
 * steadier than any single fingertip. Falls back gracefully when landmarks are
 * missing so a partial early frame can't produce NaN.
 */
export function representativeX(landmarks: ReadonlyArray<Point2D>): number {
  const xs: number[] = [];
  const wrist = landmarks[0];
  const midMcp = landmarks[9];
  if (wrist) xs.push(wrist.x);
  if (midMcp) xs.push(midMcp.x);
  if (xs.length === 0) return 0.5;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function screenXOf(hand: RawHand, mirror: boolean): number {
  const x = representativeX(hand.landmarks);
  return mirror ? 1 - x : x;
}

/**
 * Assign detected hands to the chord (left) and strum (right) roles.
 *
 * - 0 hands → `[]`.
 * - 1 hand → handedness label if confident, else which screen half it's in.
 * - 2 hands → handedness labels when both are confident AND distinct; otherwise
 *   screen-side (leftmost → chord, other → strum), which guarantees the two
 *   hands never collapse into the same role even when MediaPipe reports the
 *   same label for both.
 *
 * MediaPipe reports at most `numHands` (2) hands; any extras are ignored.
 */
export function assignHands(
  hands: ReadonlyArray<RawHand>,
  opts: AssignOptions = {},
): AssignedHand[] {
  const minScore = opts.minScore ?? 0.6;
  const mirror = opts.mirror ?? true;
  const leftHanded = opts.leftHanded ?? false;
  const roleMap =
    opts.roleMap ?? (leftHanded ? LEFT_HANDED_ROLE : DEFAULT_HANDEDNESS_ROLE);
  // Screen-side fallback: which side's hand gets the chord role.
  const chordOnLeft = !leftHanded;

  if (hands.length === 0) return [];

  const screenX = hands.map((h) => screenXOf(h, mirror));

  if (hands.length === 1) {
    const h = hands[0]!;
    const confident = h.score >= minScore;
    const role: HandRole = confident
      ? roleMap[h.handedness]
      : (screenX[0]! < 0.5) === chordOnLeft
        ? "chord"
        : "strum";
    return [
      {
        index: 0,
        role,
        handedness: h.handedness,
        score: h.score,
        screenX: screenX[0]!,
        source: confident ? "handedness" : "screen-side",
      },
    ];
  }

  // Two meaningful hands (numHands = 2).
  const a = hands[0]!;
  const b = hands[1]!;
  const roleA = roleMap[a.handedness];
  const roleB = roleMap[b.handedness];
  const confident = a.score >= minScore && b.score >= minScore;

  let aRole: HandRole;
  let bRole: HandRole;
  let source: "handedness" | "screen-side";

  if (confident && roleA !== roleB) {
    aRole = roleA;
    bRole = roleB;
    source = "handedness";
  } else {
    // Screen-side backup: leftmost hand → chord, the other → strum (mirrored
    // for left-handed players).
    source = "screen-side";
    if ((screenX[0]! <= screenX[1]!) === chordOnLeft) {
      aRole = "chord";
      bRole = "strum";
    } else {
      aRole = "strum";
      bRole = "chord";
    }
  }

  return [
    {
      index: 0,
      role: aRole,
      handedness: a.handedness,
      score: a.score,
      screenX: screenX[0]!,
      source,
    },
    {
      index: 1,
      role: bRole,
      handedness: b.handedness,
      score: b.score,
      screenX: screenX[1]!,
      source,
    },
  ];
}

/** Whether a given role is currently assigned to some hand. */
export function roleIsTracked(
  assignments: ReadonlyArray<AssignedHand>,
  role: HandRole,
): boolean {
  return assignments.some((a) => a.role === role);
}
