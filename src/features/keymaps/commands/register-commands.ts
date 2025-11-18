/**
 * Register all built-in commands
 */

import { keymapRegistry } from "../utils/registry";
import { editCommands } from "./edit-commands";
import { fileCommands } from "./file-commands";
import { navigationCommands } from "./navigation-commands";
import { viewCommands } from "./view-commands";

export function registerBuiltinCommands(): void {
  const allCommands = [...fileCommands, ...editCommands, ...viewCommands, ...navigationCommands];

  for (const command of allCommands) {
    keymapRegistry.registerCommand(command);
  }
}
