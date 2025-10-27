/**
 * Vim command parser
 * Handles: [count][operator][count][motion/text-object] and [count][action]
 * Examples: 3dw, d3w, 2ciw, c2aw, p, 3p, P, etc.
 */

import { getActionKeys } from "../actions";
import { getMotionKeys } from "./motion-registry";
import type { VimCommand } from "./types";

interface ParseState {
  count1?: number; // Count before operator/action
  operator?: string;
  count2?: number; // Count after operator
  textObjectMode?: "inner" | "around";
  motion?: string;
  textObject?: string;
  action?: string;
}

type ParseStatus = "complete" | "incomplete" | "invalid";

interface ParseResult {
  status: ParseStatus;
  command?: VimCommand;
}

interface MotionMatchResult {
  status: "complete" | "partial" | "none";
  motion?: string;
  length?: number;
}

let cachedMotionKeys: string[] | null = null;
const motionKeysDescending = (): string[] => {
  if (!cachedMotionKeys) {
    cachedMotionKeys = [...getMotionKeys()].sort((a, b) => b.length - a.length);
  }
  return cachedMotionKeys;
};

const matchMotion = (keys: string[], startIndex: number): MotionMatchResult => {
  const remaining = keys.slice(startIndex);
  if (remaining.length === 0) {
    return { status: "partial" };
  }

  const remainingString = remaining.join("");
  let hasPartialMatch = false;

  for (const motionKey of motionKeysDescending()) {
    if (motionKey.length <= remaining.length) {
      const candidate = remaining.slice(0, motionKey.length).join("");
      if (candidate === motionKey) {
        return {
          status: "complete",
          motion: motionKey,
          length: motionKey.length,
        };
      }
    } else if (motionKey.startsWith(remainingString)) {
      hasPartialMatch = true;
    }
  }

  if (hasPartialMatch) {
    return { status: "partial" };
  }

  return { status: "none" };
};

const parseNumber = (keys: string[], index: number): { value?: number; nextIndex: number } => {
  let currentIndex = index;
  if (currentIndex >= keys.length) {
    return { nextIndex: currentIndex };
  }

  if (!/[1-9]/.test(keys[currentIndex])) {
    return { nextIndex: currentIndex };
  }

  let countStr = keys[currentIndex];
  currentIndex++;
  while (currentIndex < keys.length && /[0-9]/.test(keys[currentIndex])) {
    countStr += keys[currentIndex];
    currentIndex++;
  }

  return {
    value: parseInt(countStr, 10),
    nextIndex: currentIndex,
  };
};

const parseVimCommandInternal = (keys: string[]): ParseResult => {
  if (keys.length === 0) {
    return { status: "incomplete" };
  }

  const state: ParseState = {};
  let index = 0;

  // Parse first count (before operator/action)
  const firstCount = parseNumber(keys, index);
  if (firstCount.value !== undefined) {
    state.count1 = firstCount.value;
  }
  index = firstCount.nextIndex;

  if (index >= keys.length) {
    return { status: "incomplete" };
  }

  // Check for standalone actions first (p, P, etc.)
  const potentialAction = keys[index];
  if (isActionKey(potentialAction)) {
    // Check if this is a complete action command
    if (index === keys.length - 1) {
      state.action = potentialAction;
      const command: VimCommand = {};

      if (state.count1) {
        command.count = state.count1;
      }
      command.action = state.action;

      return {
        status: "complete",
        command,
      };
    }
    // If there are more keys after the action, it's invalid
    return { status: "invalid" };
  }

  // Parse operator
  if (isOperatorKey(potentialAction)) {
    state.operator = potentialAction;
    index++;

    if (index >= keys.length) {
      return { status: "incomplete" };
    }
  }

  // Parse second count (after operator)
  const secondCount = parseNumber(keys, index);
  if (secondCount.value !== undefined) {
    state.count2 = secondCount.value;
  }
  index = secondCount.nextIndex;

  if (index >= keys.length) {
    return { status: "incomplete" };
  }

  // Parse text object mode (i or a)
  if (keys[index] === "i" || keys[index] === "a") {
    state.textObjectMode = keys[index] as "inner" | "around";
    index++;

    if (index >= keys.length) {
      return { status: "incomplete" };
    }

    state.textObject = keys[index];
    index++;
  } else if (keys[index] === state.operator) {
    state.motion = state.operator;
    index++;
  } else {
    // Parse motion (supports multi-key motions)
    const motionMatch = matchMotion(keys, index);
    if (motionMatch.status === "partial") {
      return { status: "incomplete" };
    }
    if (motionMatch.status === "none" || !motionMatch.motion || !motionMatch.length) {
      return { status: "invalid" };
    }

    state.motion = motionMatch.motion;
    index += motionMatch.length;
  }

  if (index !== keys.length) {
    return { status: "invalid" };
  }

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

  if (command.operator && !(command.motion || command.textObject)) {
    return { status: "incomplete" };
  }

  if (!command.operator && !command.motion) {
    return { status: "invalid" };
  }

  return {
    status: "complete",
    command,
  };
};

/**
 * Parse a vim command sequence
 */
export const parseVimCommand = (keys: string[]): VimCommand | null => {
  const result = parseVimCommandInternal(keys);
  return result.status === "complete" ? (result.command ?? null) : null;
};

/**
 * Check if a key is an operator
 */
const isOperatorKey = (key: string): boolean => {
  return ["d", "c", "y"].includes(key);
};

/**
 * Check if a key is an action
 */
const isActionKey = (key: string): boolean => {
  return getActionKeys().includes(key);
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
  return parseVimCommandInternal(keys).status === "complete";
};

/**
 * Check if more keys are expected
 */
export const expectsMoreKeys = (keys: string[]): boolean => {
  return parseVimCommandInternal(keys).status === "incomplete";
};

/**
 * Get current parse status for a key sequence
 */
export const getCommandParseStatus = (keys: string[]): ParseStatus => {
  return parseVimCommandInternal(keys).status;
};
