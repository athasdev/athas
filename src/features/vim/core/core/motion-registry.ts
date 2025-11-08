/**
 * Central registry for all vim motions
 */

import {
  charDown,
  charLeft,
  charRight,
  charUp,
  repeatFindChar,
  repeatFindCharReverse,
} from "../motions/character-motions";
import { fileEnd, fileStart } from "../motions/file-motions";
import {
  lineEnd,
  lineFirstNonBlank,
  lineFirstNonBlankUnderscore,
  lineStart,
} from "../motions/line-motions";
import { viewportBottom, viewportMiddle, viewportTop } from "../motions/viewport-motions";
import {
  WORDBackward,
  WORDEnd,
  WORDForward,
  wordBackward,
  wordEnd,
  wordForward,
  wordPreviousEnd,
} from "../motions/word-motions";
import type { Motion } from "./types";

/**
 * Registry of all available motions
 */
export const motionRegistry: Record<string, Motion> = {
  // Word motions
  w: wordForward,
  b: wordBackward,
  e: wordEnd,
  ge: wordPreviousEnd,
  W: WORDForward,
  B: WORDBackward,
  E: WORDEnd,
  gg: fileStart,
  G: fileEnd,

  // Line motions
  "0": lineStart,
  $: lineEnd,
  "^": lineFirstNonBlank,
  _: lineFirstNonBlankUnderscore,

  // Character motions
  h: charLeft,
  l: charRight,
  j: charDown,
  k: charUp,
  ";": repeatFindChar,
  ",": repeatFindCharReverse,

  // Viewport motions
  H: viewportTop,
  M: viewportMiddle,
  L: viewportBottom,
};

/**
 * Get a motion by key
 */
export const getMotion = (key: string): Motion | undefined => {
  return motionRegistry[key];
};

/**
 * Check if a key is a registered motion
 */
export const isMotion = (key: string): boolean => {
  return key in motionRegistry;
};

/**
 * Get all motion keys
 */
export const getMotionKeys = (): string[] => {
  return Object.keys(motionRegistry);
};
