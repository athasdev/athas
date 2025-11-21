import { Terminal } from "lucide-react";
import type { Action } from "@/features/command-palette/models/action.types";
import type { Command } from "../types";
import { parseKeybinding } from "./parser";

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

/**
 * Convert a keybinding string to display format
 * "cmd+s" -> ["⌘", "S"]
 * "cmd+k cmd+t" -> ["⌘", "K", "⌘", "T"]
 */
export function keybindingToDisplay(keybinding: string): string[] {
  const parsed = parseKeybinding(keybinding);
  const keys: string[] = [];

  for (const part of parsed.parts) {
    // Add modifiers
    for (const mod of part.modifiers) {
      if (mod === "cmd" && isMac) {
        keys.push("⌘");
      } else if (mod === "cmd") {
        keys.push("Ctrl");
      } else if (mod === "ctrl") {
        keys.push("Ctrl");
      } else if (mod === "alt") {
        keys.push(isMac ? "⌥" : "Alt");
      } else if (mod === "shift") {
        keys.push("⇧");
      }
    }

    // Add main key
    keys.push(part.key.toUpperCase());
  }

  return keys;
}

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
