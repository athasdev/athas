import { useVimStore, type VimMode } from "@/features/vim/stores/vim.store";
import type { Command } from "../types/keymaps.types";

function vimModeCommand(mode: VimMode, name: string, description: string): Command {
  return {
    id: `vim.enter${name}Mode`,
    title: `Vim: Enter ${name} Mode`,
    category: "Vim",
    description,
    when: ({ settings }) => settings.vimMode,
    palette: true,
    execute: () => useVimStore.getState().actions.setMode(mode),
  };
}

export const vimModeCommands: Command[] = [
  vimModeCommand("normal", "Normal", "Switch to normal mode"),
  vimModeCommand("insert", "Insert", "Switch to insert mode"),
  vimModeCommand("visual", "Visual", "Switch to visual mode (character)"),
];
