import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { keymapRegistry } from "../utils/registry";

afterEach(() => {
  keymapRegistry.clear();
});

describe("keymap registry", () => {
  it("keeps the first registration when a command id is registered twice", () => {
    const first = vi.fn();
    const second = vi.fn();

    keymapRegistry.registerCommand({ id: "test.run", title: "Run", execute: first });
    keymapRegistry.registerCommand({ id: "test.run", title: "Run again", execute: second });

    expect(keymapRegistry.getAllCommands()).toHaveLength(1);
    expect(keymapRegistry.getCommand("test.run")?.title).toBe("Run");
  });

  it("executes commands with their arguments", async () => {
    const execute = vi.fn();
    keymapRegistry.registerCommand({ id: "test.open", title: "Open", execute });

    await keymapRegistry.executeCommand("test.open", { path: "/a.ts" });

    expect(execute).toHaveBeenCalledWith({ path: "/a.ts" });
  });

  it("contains failures from missing or throwing commands", async () => {
    keymapRegistry.registerCommand({
      id: "test.fail",
      title: "Fail",
      execute: async () => {
        throw new Error("boom");
      },
    });

    await expect(keymapRegistry.executeCommand("test.fail")).resolves.toBeUndefined();
    await expect(keymapRegistry.executeCommand("test.missing")).resolves.toBeUndefined();
  });

  it("ignores duplicate keybindings from the same source but keeps other sources", () => {
    const binding = { key: "cmd+s", command: "file.save", source: "default" as const };

    keymapRegistry.registerKeybinding(binding);
    keymapRegistry.registerKeybinding({ ...binding });
    keymapRegistry.registerKeybinding({ ...binding, source: "extension" });
    keymapRegistry.registerKeybinding({ ...binding, when: "editorFocus" });

    expect(keymapRegistry.getKeybindingsForKey("cmd+s")).toHaveLength(3);
  });

  it("removes every keybinding for an unregistered command", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });
    keymapRegistry.registerKeybinding({
      key: "cmd+alt+s",
      command: "file.save",
      source: "extension",
    });
    keymapRegistry.registerKeybinding({ key: "cmd+o", command: "file.open", source: "default" });

    keymapRegistry.unregisterKeybinding("file.save");

    expect(keymapRegistry.getAllKeybindings().map((binding) => binding.command)).toEqual([
      "file.open",
    ]);
    expect(keymapRegistry.getKeybinding("file.save")).toBeUndefined();
  });

  it("returns a copy of the keybinding list", () => {
    keymapRegistry.registerKeybinding({ key: "cmd+s", command: "file.save", source: "default" });

    keymapRegistry.getAllKeybindings().pop();

    expect(keymapRegistry.getAllKeybindings()).toHaveLength(1);
  });
});
