/**
 * Central registry for all vim actions
 */

import type { Action } from "../core/types";
import { pasteAction, pasteBeforeAction } from "./paste-actions";

/**
 * Registry of all available actions
 */
export const actionRegistry: Record<string, Action> = {
  p: pasteAction,
  P: pasteBeforeAction,
};

/**
 * Get an action by key
 */
export const getAction = (key: string): Action | undefined => {
  return actionRegistry[key];
};

/**
 * Check if a key is a registered action
 */
export const isAction = (key: string): boolean => {
  return key in actionRegistry;
};

/**
 * Get all action keys
 */
export const getActionKeys = (): string[] => {
  return Object.keys(actionRegistry);
};

// Re-export actions
export { pasteAction, pasteBeforeAction } from "./paste-actions";
