/**
 * Key buffer for accumulating vim command keys
 * Handles: [count][operator][count][motion/text-object]
 */

import { expectsMoreKeys, isCommandComplete } from "./command-parser";

/**
 * Key buffer state
 */
interface KeyBufferState {
  keys: string[];
  timeout: NodeJS.Timeout | null;
}

const state: KeyBufferState = {
  keys: [],
  timeout: null,
};

/**
 * Add a key to the buffer
 */
export const addKey = (key: string): void => {
  state.keys.push(key);

  // Clear existing timeout
  if (state.timeout) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }

  // Set timeout to clear buffer if no more keys come (1 second)
  state.timeout = setTimeout(() => {
    clearKeys();
  }, 1000);
};

/**
 * Get current keys in buffer
 */
export const getKeys = (): string[] => {
  return [...state.keys];
};

/**
 * Clear the key buffer
 */
export const clearKeys = (): void => {
  state.keys = [];
  if (state.timeout) {
    clearTimeout(state.timeout);
    state.timeout = null;
  }
};

/**
 * Check if buffer is waiting for more keys
 */
export const isWaitingForMoreKeys = (): boolean => {
  if (state.keys.length === 0) return false;
  return expectsMoreKeys(state.keys);
};

/**
 * Check if buffer has a complete command
 */
export const hasCompleteCommand = (): boolean => {
  if (state.keys.length === 0) return false;
  return isCommandComplete(state.keys);
};

/**
 * Get the current key sequence as a string (for display)
 */
export const getKeyString = (): string => {
  return state.keys.join("");
};
