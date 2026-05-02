import { TerminalWindow as Terminal } from "@phosphor-icons/react";
import type { Action } from "@/features/command-palette/models/action.types";
import type { Command } from "../types";

/**
 * Convert a Command from the keymaps registry to an Action for the command palette
 */
export function commandToAction(command: Command, onClose: () => void): Action {
  return {
    id: command.id,
    label: command.title,
    description: command.description || command.id,
    icon: command.icon || <Terminal />,
    category: command.category || "Other",
    commandId: command.id,
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
