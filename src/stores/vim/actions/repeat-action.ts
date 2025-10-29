/**
 * Repeat action (.)
 */

import { useVimStore } from "../../vim-store";
import { executeVimCommand } from "../core/command-executor";
import type { Action } from "../core/types";

/**
 * Repeat action - repeats the last operation
 */
export const repeatAction: Action = {
  name: "repeat",
  repeatable: false, // The dot command itself is not repeatable

  execute: (): void => {
    const lastOperation = useVimStore.getState().lastOperation;

    if (!lastOperation || !lastOperation.keys || lastOperation.keys.length === 0) {
      // Nothing to repeat
      return;
    }

    // Execute the last command
    const success = executeVimCommand(lastOperation.keys);

    if (!success) {
      console.warn("Failed to repeat last operation:", lastOperation.keys);
    }
  },
};
