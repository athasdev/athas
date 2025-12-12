/**
 * Motion kind resolution
 *
 * Determines whether a motion is characterwise, linewise, or blockwise.
 * This affects how operators like delete, change, and yank behave.
 *
 * Vim documentation: :help motion.txt
 */

import type { Motion } from "./ast";

/**
 * Motion kind (characterwise, linewise, or blockwise)
 */
export type MotionKind = "char" | "line" | "block";

/**
 * Motion inclusivity (whether the motion includes the end position)
 */
export type MotionInclusivity = "inclusive" | "exclusive";

/**
 * Complete motion info
 */
export interface MotionInfo {
  kind: MotionKind;
  inclusive: MotionInclusivity;
}

/**
 * Linewise motions (operate on entire lines)
 *
 * Reference: :help linewise-motion
 */
const linewiseMotions = new Set([
  "_", // First non-blank character (linewise)
  "gg", // First line
  "G", // Last line / goto line
  "j", // Down
  "k", // Up
  "{", // Paragraph backward
  "}", // Paragraph forward
  "(", // Sentence backward
  ")", // Sentence forward
  "H", // Top of screen
  "M", // Middle of screen
  "L", // Bottom of screen
  "]]", // Section forward
  "[[", // Section backward
  "][", // Section end forward
  "[]", // Section end backward
  "]m", // Method forward
  "[m", // Method backward
]);

/**
 * Inclusive characterwise motions
 *
 * Most characterwise motions are exclusive, but some are inclusive.
 * Reference: :help inclusive
 */
const inclusiveMotions = new Set([
  "l", // Right (inclusive)
  "$", // End of line (inclusive)
  " ", // Right (space - same as l)
  "f", // Find character forward (inclusive)
  "t", // Till character forward (inclusive)
  "F", // Find character backward (inclusive)
  "T", // Till character backward (inclusive)
  ";", // Repeat f/F/t/T (inclusive)
  ",", // Repeat f/F/t/T reverse (inclusive)
  "%", // Matching bracket (inclusive)
  "/", // Search forward (inclusive)
  "?", // Search backward (inclusive)
  "n", // Repeat search (inclusive)
  "N", // Repeat search reverse (inclusive)
  "*", // Search word under cursor forward (inclusive)
  "#", // Search word under cursor backward (inclusive)
]);

/**
 * Exclusive characterwise motions
 *
 * Default for characterwise motions.
 * Reference: :help exclusive
 */
const exclusiveMotions = new Set([
  "h", // Left
  "w", // Word forward
  "W", // WORD forward
  "e", // End of word
  "E", // End of WORD
  "b", // Word backward
  "B", // WORD backward
  "ge", // End of previous word
  "gE", // End of previous WORD
  "0", // Start of line
  "^", // First non-blank
  "g_", // Last non-blank
  "gj", // Down display line
  "gk", // Up display line
  "g0", // Start of display line
  "g^", // First non-blank of display line
  "g$", // End of display line
]);

/**
 * Get motion kind (char, line, or block) for a given motion
 *
 * @param motion - The motion AST node
 * @returns Motion information (kind and inclusivity)
 */
export function getMotionInfo(motion: Motion): MotionInfo {
  // Simple motions
  if (motion.type === "simple") {
    if (linewiseMotions.has(motion.key)) {
      return { kind: "line", inclusive: "inclusive" };
    }

    if (inclusiveMotions.has(motion.key)) {
      return { kind: "char", inclusive: "inclusive" };
    }

    if (exclusiveMotions.has(motion.key)) {
      return { kind: "char", inclusive: "exclusive" };
    }

    // Default: characterwise exclusive
    return { kind: "char", inclusive: "exclusive" };
  }

  // Character motions (f, F, t, T)
  if (motion.type === "char") {
    // f, F, t, T are all inclusive
    return { kind: "char", inclusive: "inclusive" };
  }

  // Search motions (/, ?)
  if (motion.type === "search") {
    // Search is inclusive
    return { kind: "char", inclusive: "inclusive" };
  }

  // Search repeat motions (n, N, *, #)
  if (motion.type === "searchRepeat") {
    // Search repeats are inclusive
    return { kind: "char", inclusive: "inclusive" };
  }

  // Mark motions (', `)
  if (motion.type === "mark") {
    // ' is linewise, ` is characterwise exclusive
    if (motion.style === "'") {
      return { kind: "line", inclusive: "inclusive" };
    } else {
      return { kind: "char", inclusive: "exclusive" };
    }
  }

  // Prefixed motions (g, z, [, ])
  if (motion.type === "prefixed") {
    const fullKey = motion.head + motion.tail;

    if (linewiseMotions.has(fullKey)) {
      return { kind: "line", inclusive: "inclusive" };
    }

    if (inclusiveMotions.has(fullKey)) {
      return { kind: "char", inclusive: "inclusive" };
    }

    if (exclusiveMotions.has(fullKey)) {
      return { kind: "char", inclusive: "exclusive" };
    }

    // Default for unknown prefixed motions
    return { kind: "char", inclusive: "exclusive" };
  }

  // Fallback: characterwise exclusive
  return { kind: "char", inclusive: "exclusive" };
}

/**
 * Resolve final motion kind with forced kind override
 *
 * The v/V/<C-V> prefixes can force a motion to be char/line/block.
 *
 * @param motion - The motion AST node
 * @param forcedKind - Optional forced kind (from v, V, or Ctrl-V)
 * @returns Final motion kind
 */
export function resolveMotionKind(
  motion: Motion,
  forcedKind?: "char" | "line" | "block",
): MotionKind {
  if (forcedKind) {
    return forcedKind;
  }

  const info = getMotionInfo(motion);
  return info.kind;
}

/**
 * Check if a motion is inclusive
 *
 * @param motion - The motion AST node
 * @returns True if motion is inclusive
 */
export function isMotionInclusive(motion: Motion): boolean {
  const info = getMotionInfo(motion);
  return info.inclusive === "inclusive";
}
