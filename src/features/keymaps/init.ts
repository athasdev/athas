/**
 * Initialize the keymaps system
 * Call this once at app startup
 */

import { registerBuiltinCommands } from "./commands/register-commands";
import { registerDefaultKeymaps } from "./defaults/register-defaults";

export function initializeKeymaps(): void {
  // Register all built-in commands
  registerBuiltinCommands();

  // Register default keybindings
  registerDefaultKeymaps();
}
