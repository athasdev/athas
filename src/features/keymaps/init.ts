/**
 * Initialize the keymaps system
 * Call this once at app startup
 */

import { registerCommands } from "./commands/command-registry";
import { registerDefaultKeymaps } from "./defaults/register-defaults";

let initialized = false;

export function initializeKeymaps(): void {
  if (initialized) return;
  initialized = true;

  // Register all commands from the unified registry
  registerCommands();

  // Register default keybindings
  registerDefaultKeymaps();
}
