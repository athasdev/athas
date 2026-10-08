import type { Command } from "../types/keymaps.types";
import { keymapRegistry } from "../utils/registry";
import { agentEditCommands, aiCommands } from "./ai-commands";
import { browserCommands } from "./browser-commands";
import { editCommands, markdownCommands } from "./editor-commands";
import { fileCommands } from "./file-commands";
import { githubCommands } from "./github-commands";
import { gitCommands } from "./git-commands";
import { developerCommands, lspCommands } from "./lsp-commands";
import { navigationCommands } from "./navigation-commands";
import { paneCommands } from "./pane-commands";
import { settingsCommands } from "./settings-commands";
import { terminalCommands } from "./terminal-commands";
import { databaseCommands, viewCommands } from "./view-commands";
import { vimModeCommands } from "./vim-mode-commands";
import { windowCommands } from "./window-commands";

/**
 * Every built-in command. Keybindings live in `defaults/default-keymaps.ts` and the user keymap;
 * the command palette shows the commands that declare `palette`, ordered by
 * `command-palette/constants/command-palette-order.ts`.
 */
export const builtInCommands: Command[] = [
  ...fileCommands,
  ...browserCommands,
  ...editCommands,
  ...terminalCommands,
  ...lspCommands,
  ...viewCommands,
  ...navigationCommands,
  ...paneCommands,
  ...databaseCommands,
  ...windowCommands,
  ...agentEditCommands,
  ...markdownCommands,
  ...gitCommands,
  ...githubCommands,
  ...settingsCommands,
  ...aiCommands,
  ...developerCommands,
  ...vimModeCommands,
];

export function registerCommands(): void {
  for (const command of builtInCommands) {
    keymapRegistry.registerCommand(command);
  }
}
