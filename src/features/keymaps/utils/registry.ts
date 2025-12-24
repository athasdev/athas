/**
 * Command and keybinding registry
 * Central system for registering and executing commands
 */

import { logger } from "@/features/editor/utils/logger";
import type { Command, Keybinding } from "../types";

class KeymapRegistry {
  private commands = new Map<string, Command>();
  private keybindings: Keybinding[] = [];

  registerCommand(command: Command): void {
    if (this.commands.has(command.id)) {
      logger.warn("Keymaps", `Command already registered: ${command.id}`);
      return;
    }

    this.commands.set(command.id, command);
    logger.debug("Keymaps", `Registered command: ${command.id}`);
  }

  unregisterCommand(commandId: string): void {
    this.commands.delete(commandId);
    logger.debug("Keymaps", `Unregistered command: ${commandId}`);
  }

  getCommand(commandId: string): Command | undefined {
    return this.commands.get(commandId);
  }

  getAllCommands(): Command[] {
    return Array.from(this.commands.values());
  }

  registerKeybinding(keybinding: Keybinding): void {
    const existing = this.keybindings.find((kb) => kb.command === keybinding.command);
    if (existing && existing.source === keybinding.source) {
      logger.warn("Keymaps", `Keybinding already exists for command: ${keybinding.command}`);
      return;
    }

    this.keybindings.push(keybinding);
    logger.debug("Keymaps", `Registered keybinding: ${keybinding.key} -> ${keybinding.command}`);
  }

  unregisterKeybinding(commandId: string): void {
    this.keybindings = this.keybindings.filter((kb) => kb.command !== commandId);
    logger.debug("Keymaps", `Unregistered keybinding for: ${commandId}`);
  }

  getKeybinding(commandId: string): Keybinding | undefined {
    return this.keybindings.find((kb) => kb.command === commandId);
  }

  getKeybindingsForKey(key: string): Keybinding[] {
    return this.keybindings.filter((kb) => kb.key === key);
  }

  getAllKeybindings(): Keybinding[] {
    return [...this.keybindings];
  }

  async executeCommand(commandId: string, args?: unknown): Promise<void> {
    const command = this.commands.get(commandId);

    if (!command) {
      logger.error("Keymaps", `Command not found: ${commandId}`);
      return;
    }

    try {
      logger.debug("Keymaps", `Executing command: ${commandId}`);
      await command.execute(args);
    } catch (error) {
      logger.error("Keymaps", `Error executing command ${commandId}:`, error);
    }
  }

  clear(): void {
    this.commands.clear();
    this.keybindings = [];
  }
}

export const keymapRegistry = new KeymapRegistry();
