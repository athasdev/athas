import { Terminal } from "lucide-react";
import type { Action } from "@/features/command-palette/models/action.types";
import { keybindingToDisplay } from "@/utils/keybinding-display";
import type { Command } from "../types";

/**
 * Convert a Command from the keymaps registry to an Action for the command palette
 */
export function commandToAction(command: Command, onClose: () => void): Action {
  return {
    id: command.id,
    label: command.title,
    description: command.description || command.id,
    icon: command.icon || <Terminal size={14} />,
    category: command.category || "Other",
    keybinding: command.keybinding ? keybindingToDisplay(command.keybinding) : undefined,
    action: () => {
      command.execute();
      onClose();
    },
  };
}

/**
 * Convert all commands from the keymaps registry to actions
 */
export function commandsToActions(commands: Command[], onClose: () => void): Action[] {
  return commands.map((cmd) => commandToAction(cmd, onClose));
}
