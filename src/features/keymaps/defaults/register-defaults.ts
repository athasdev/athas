/**
 * Register default keybindings
 */

import { keymapRegistry } from "../utils/registry";
import { defaultKeymaps } from "./default-keymaps";

export function registerDefaultKeymaps(): void {
  for (const keybinding of defaultKeymaps) {
    keymapRegistry.registerKeybinding(keybinding);
  }
}
