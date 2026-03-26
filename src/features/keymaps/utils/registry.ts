/**
 * Command and keybinding registry
 * Central system for registering and executing commands
 */

import { logger } from "@/features/editor/utils/logger";
import type { Command, Keybinding } from "../types";

class KeymapRegistry {
  private commands = new Map<string, Command>();
  private commandAliases = new Map<string, string>();
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
    this.commandAliases.forEach((targetId, aliasId) => {
      if (targetId === commandId || aliasId === commandId) {
        this.commandAliases.delete(aliasId);
      }
    });
    logger.debug("Keymaps", `Unregistered command: ${commandId}`);
  }

  registerCommandAlias(aliasId: string, targetId: string): void {
    if (!this.commands.has(targetId)) {
      logger.warn("Keymaps", `Cannot alias missing command ${targetId} to ${aliasId}`);
      return;
    }

    this.commandAliases.set(aliasId, targetId);
    logger.debug("Keymaps", `Registered command alias: ${aliasId} -> ${targetId}`);
  }

  getCommand(commandId: string): Command | undefined {
    const resolvedId = this.commandAliases.get(commandId) ?? commandId;
    return this.commands.get(resolvedId);
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
    const resolvedId = this.commandAliases.get(commandId) ?? commandId;
    const command = this.commands.get(resolvedId);

    if (!command) {
      logger.error("Keymaps", `Command not found: ${commandId}`);
      return;
    }

    try {
      logger.debug("Keymaps", `Executing command: ${resolvedId}`);
      await command.execute(args);
    } catch (error) {
      logger.error("Keymaps", `Error executing command ${resolvedId}:`, error);
    }
  }

  clear(): void {
    this.commands.clear();
    this.commandAliases.clear();
    this.keybindings = [];
  }
}

export const keymapRegistry = new KeymapRegistry();
