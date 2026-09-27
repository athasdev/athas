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

  it("binds selection-to-chat shortcuts without taking select all occurrences", () => {
    expectKeybinding("editor.addSelectionToChat", "cmd+l", "editorFocus");
    expectKeybinding("editor.addSelectionToNewChat", "cmd+alt+l", "editorFocus");
    expectKeybinding("editor.selectAllOccurrences", "cmd+shift+l", "editorFocus");
    const editorKeys = defaultKeymaps
      .filter((keybinding) => keybinding.when === "editorFocus")
      .map((keybinding) => keybinding.key);
    expect(editorKeys.filter((key) => key === "cmd+l" || key === "cmd+alt+l")).toHaveLength(2);
  });

  it("keeps and undoes agent changes only while the editor shows them", () => {
    const when = "editorFocus && agentEditHunks";
    expectKeybinding("ai.keepAgentHunk", "cmd+y", when);
    expectKeybinding("ai.rejectAgentHunk", "cmd+n", when);
    // Earlier bindings win, so these must come before redo and new tab.
    const index = (command: string, key: string) =>
      defaultKeymaps.findIndex((binding) => binding.command === command && binding.key === key);
    expect(index("ai.keepAgentHunk", "cmd+y")).toBeLessThan(index("editor.redo", "cmd+y"));
    expect(index("ai.rejectAgentHunk", "cmd+n")).toBeLessThan(index("workbench.newTab", "cmd+n"));
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

  it("adds vertical cursors with Ctrl+Up and Ctrl+Down in Vim mode", () => {
    expectKeybinding("editor.insertCursorAbove", "ctrl+up", "editorFocus && vimMode");
    expectKeybinding("editor.insertCursorBelow", "ctrl+down", "editorFocus && vimMode");
  });

  it("keeps chrome actions in the command registry", () => {
    expectKeybinding("workbench.openSettings", "cmd+,");
    expectKeybinding("workbench.toggleSidebar", "cmd+b");
    expectKeybinding("workbench.toggleSidebar", "cmd+e");
    expectKeybinding("workbench.showFind", "cmd+f", "editorFocus");
    expectKeybinding("workbench.showFindReplace", "ctrl+h", "editorFocus");
    expectKeybinding("terminal.find", "cmd+f", "terminalFocus");
    expectKeybinding("terminal.split", "cmd+d", "terminalFocus");
    expectKeybinding("terminal.splitDown", "cmd+shift+d", "terminalFocus");
    expectKeybinding("terminal.previousCommand", "cmd+up", "terminalFocus");
    expectKeybinding("terminal.nextCommand", "cmd+down", "terminalFocus");
    expectKeybinding("terminal.focusNextPane", "cmd+alt+right", "terminalFocus");
    expectKeybinding("terminal.focusPreviousPane", "cmd+alt+left", "terminalFocus");
    expectKeybinding("terminal.clear", "cmd+k", "terminalFocus");
    expectKeybinding("terminal.selectAll", "cmd+shift+a", "terminalFocus");
    expectKeybinding("terminal.copyLastCommandOutput", "cmd+shift+c", "terminalFocus");
    expectKeybinding("workbench.toggleActivePaneFullscreen", "cmd+k z");
  });

  it("keeps Ctrl+Tab navigation in the frontend keymap", () => {
    expectKeybinding("workbench.nextTabCtrlTab", "ctrl+tab");
    expectKeybinding("workbench.previousTabCtrlTab", "ctrl+shift+tab");
  });

  it("has registered commands for every default keybinding", () => {
    keymapRegistry.clear();
    registerCommands();

    const missingCommands = defaultKeymaps
      .filter((keybinding) => !keymapRegistry.getCommand(keybinding.command))
      .map((keybinding) => `${keybinding.key} -> ${keybinding.command}`);

    expect(missingCommands).toEqual([]);
  });

  it("binds the new window shortcut to a registered command", () => {
    keymapRegistry.clear();
    registerCommands();

    expectKeybinding("workbench.newWindow", "cmd+shift+n");
    expect(keymapRegistry.getCommand("workbench.newWindow")).toMatchObject({
      title: "New Window",
    });
  });

  it("keeps the activity bar out of the command registry", () => {
    keymapRegistry.clear();
    registerCommands();

    expect(keymapRegistry.getCommand("workbench.toggleActivitySidebar")).toBeUndefined();
    expect(keymapRegistry.getCommand("workbench.toggleSidebar")).toMatchObject({
      title: "Toggle Sidebar",
    });
  });
});
