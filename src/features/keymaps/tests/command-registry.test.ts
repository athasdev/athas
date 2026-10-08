import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { builtInCommands, registerCommands } from "../commands/command-registry";
import { defaultKeymaps } from "../defaults/default-keymaps";
import { keymapRegistry } from "../utils/registry";

describe("built-in commands", () => {
  beforeEach(() => {
    keymapRegistry.clear();
    registerCommands();
  });

  afterEach(() => {
    keymapRegistry.clear();
  });

  it("registers every command once under a unique id", () => {
    const ids = builtInCommands.map((command) => command.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(keymapRegistry.getAllCommands()).toHaveLength(ids.length);
  });

  it("binds every default keybinding to a registered command", () => {
    const unknownCommands = defaultKeymaps
      .filter((keybinding) => !keymapRegistry.getCommand(keybinding.command))
      .map((keybinding) => `${keybinding.key} -> ${keybinding.command}`);

    expect(unknownCommands).toEqual([]);
  });

  it("declares keybindings only in the keymap, never on the command", () => {
    const commandsWithBindings = keymapRegistry
      .getAllCommands()
      .filter((command) => "keybinding" in command)
      .map((command) => command.id);

    expect(commandsWithBindings).toEqual([]);
  });

  it("gives every palette command a title and a category", () => {
    const incomplete = keymapRegistry
      .getAllCommands()
      .filter((command) => command.palette)
      .filter((command) => !command.title.trim() || !command.category?.trim())
      .map((command) => command.id);

    expect(incomplete).toEqual([]);
  });

  it("shows palette keybindings only from registered commands", () => {
    const unknownTargets = keymapRegistry
      .getAllCommands()
      .flatMap((command) =>
        typeof command.palette === "object" && command.palette.keybindingCommandId
          ? [command.palette.keybindingCommandId]
          : [],
      )
      .filter((commandId) => !keymapRegistry.getCommand(commandId));

    expect(unknownTargets).toEqual([]);
  });
});
