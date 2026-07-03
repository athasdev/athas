import { afterEach, describe, expect, it } from "vite-plus/test";
import { registerCommands } from "../commands/command-registry";
import { defaultKeymaps } from "../defaults/default-keymaps";
import { keymapRegistry } from "../utils/registry";

function expectKeybinding(command: string, key: string, when?: string) {
  expect(defaultKeymaps).toContainEqual(
    expect.objectContaining({
      command,
      key,
      ...(when ? { when } : {}),
    }),
  );
}

describe("default keymaps", () => {
  afterEach(() => {
    keymapRegistry.clear();
  });

  it("registers editor navigation and folding shortcuts", () => {
    const byCommand = new Map(defaultKeymaps.map((keybinding) => [keybinding.command, keybinding]));

    expect(byCommand.get("editor.goToBracket")).toMatchObject({
      key: "cmd+shift+\\",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.goToImplementation")).toMatchObject({
      key: "cmd+F12",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.removeBrackets")).toMatchObject({
      key: "cmd+alt+backspace",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.selectAllOccurrences")).toMatchObject({
      key: "cmd+shift+l",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.insertCursorAbove")).toMatchObject({
      key: "cmd+alt+up",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.insertCursorBelow")).toMatchObject({
      key: "cmd+alt+down",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.insertCursorsAtLineEnds")).toMatchObject({
      key: "shift+alt+i",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.expandSelection")).toMatchObject({
      key: "cmd+ctrl+shift+right",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.shrinkSelection")).toMatchObject({
      key: "cmd+ctrl+shift+left",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.foldAll")).toMatchObject({
      key: "cmd+k cmd+0",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.foldLevel1")).toMatchObject({
      key: "cmd+k cmd+1",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.foldLevel7")).toMatchObject({
      key: "cmd+k cmd+7",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.unfoldAll")).toMatchObject({
      key: "cmd+k cmd+j",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.triggerSuggest")).toMatchObject({
      key: "ctrl+space",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.triggerParameterHints")).toMatchObject({
      key: "cmd+shift+space",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.showHover")).toMatchObject({
      key: "cmd+k cmd+i",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.quickFix")).toMatchObject({
      key: "cmd+.",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.formatSelection")).toMatchObject({
      key: "cmd+k cmd+f",
      when: "editorFocus",
    });
    expect(byCommand.get("editor.toggleWordWrap")).toMatchObject({
      key: "alt+z",
      when: "editorFocus",
    });
    expect(byCommand.get("file.saveAll")).toMatchObject({
      key: "cmd+alt+s",
      when: "editorFocus",
    });
  });

  it("registers basic edit shortcuts", () => {
    expectKeybinding("editor.selectAll", "cmd+a", "editorFocus");
    expectKeybinding("editor.undo", "cmd+z", "editorFocus");
    expectKeybinding("editor.redo", "cmd+shift+z", "editorFocus");
    expectKeybinding("editor.redo", "cmd+y", "editorFocus");
    expectKeybinding("editor.copy", "cmd+c", "editorFocus");
    expectKeybinding("editor.cut", "cmd+x", "editorFocus");
    expectKeybinding("editor.paste", "cmd+v", "editorFocus");
  });

  it("has registered commands for every default keybinding", () => {
    keymapRegistry.clear();
    registerCommands();

    const missingCommands = defaultKeymaps
      .filter((keybinding) => !keymapRegistry.getCommand(keybinding.command))
      .map((keybinding) => `${keybinding.key} -> ${keybinding.command}`);

    expect(missingCommands).toEqual([]);
  });
});
