/**
 * Vim command parser
 * Handles: [count][operator][count][motion/text-object]
 * Examples: 3dw, d3w, 2ciw, c2aw, etc.
 */

import type { VimCommand } from "./types";

interface ParseState {
  count1?: number; // Count before operator
  operator?: string;
  count2?: number; // Count after operator
  textObjectMode?: "inner" | "around";
  motion?: string;
  textObject?: string;
}

/**
 * Parse a vim command sequence
 */
export const parseVimCommand = (keys: string[]): VimCommand | null => {
  if (keys.length === 0) return null;

  const state: ParseState = {};
  let index = 0;

  // Parse first count (before operator)
  let countStr = "";
  while (index < keys.length && /[1-9]/.test(keys[index])) {
    countStr += keys[index];
    index++;
  }
  if (index < keys.length && /[0-9]/.test(keys[index])) {
    while (index < keys.length && /[0-9]/.test(keys[index])) {
      countStr += keys[index];
      index++;
    }
  }
  if (countStr) {
    state.count1 = parseInt(countStr);
  }

  if (index >= keys.length) return null;

  // Parse operator
  const potentialOperator = keys[index];
  if (isOperatorKey(potentialOperator)) {
    state.operator = potentialOperator;
    index++;
  }

  if (index >= keys.length) {
    // Just an operator, need motion/text-object
    return null;
  }

  // Parse second count (after operator)
  countStr = "";
  while (index < keys.length && /[1-9]/.test(keys[index])) {
    countStr += keys[index];
    index++;
  }
  if (index < keys.length && /[0-9]/.test(keys[index])) {
    while (index < keys.length && /[0-9]/.test(keys[index])) {
      countStr += keys[index];
      index++;
    }
  }
  if (countStr) {
    state.count2 = parseInt(countStr);
  }

  if (index >= keys.length) return null;

  // Parse text object mode (i or a)
  if (keys[index] === "i" || keys[index] === "a") {
    state.textObjectMode = keys[index] as "inner" | "around";
    index++;

    if (index >= keys.length) return null;

    // Next key should be the text object
    state.textObject = keys[index];
    index++;
  } else {
    // Parse motion
    state.motion = keys[index];
    index++;
  }

  // Build the final command
  const command: VimCommand = {};

  // Combine counts (count1 * count2)
  if (state.count1 && state.count2) {
    command.count = state.count1 * state.count2;
  } else if (state.count1) {
    command.count = state.count1;
  } else if (state.count2) {
    command.count = state.count2;
  }

  if (state.operator) {
    command.operator = state.operator;
  }

  if (state.textObject && state.textObjectMode) {
    command.textObject = {
      mode: state.textObjectMode,
      object: state.textObject,
    };
  } else if (state.motion) {
    command.motion = state.motion;
  }

  return command;
};

/**
 * Check if a key is an operator
 * Note: Import from operators registry to stay in sync
 */
const isOperatorKey = (key: string): boolean => {
  return ["d", "c", "y"].includes(key);
};

/**
 * Get the effective count from a vim command
 */
export const getEffectiveCount = (command: VimCommand): number => {
  return command.count || 1;
};

/**
 * Check if a command is complete
 */
export const isCommandComplete = (keys: string[]): boolean => {
  if (keys.length === 0) return false;

  // Try to parse
  const command = parseVimCommand(keys);
  if (!command) return false;

  // A command is complete if it has either:
  // 1. An operator + (motion or text object)
  // 2. Just a motion (for navigation)
  if (command.operator) {
    return !!(command.motion || command.textObject);
  }

  return !!command.motion;
};

/**
 * Check if more keys are expected
 */
export const expectsMoreKeys = (keys: string[]): boolean => {
  if (keys.length === 0) return true;

  // Count without operator/motion
  if (keys.every((k) => /[0-9]/.test(k))) return true;

  // Operator without motion/text-object
  const lastKey = keys[keys.length - 1];
  if (isOperatorKey(lastKey)) return true;

  // Text object mode without object
  if (lastKey === "i" || lastKey === "a") {
    // Check if previous key was an operator
    if (keys.length >= 2) {
      const prevKey = keys[keys.length - 2];
      if (isOperatorKey(prevKey) || /[0-9]/.test(prevKey)) {
        return true;
      }
    }
  }

  return !isCommandComplete(keys);
};
