import { describe, expect, it, vi } from "vite-plus/test";
import type { editor } from "monaco-editor";
import { registerMonacoHistoryActions } from "../engines/monaco/history-actions";
import { registerMonacoVimCommands } from "../engines/monaco/vim-commands";
import { VimMode } from "monaco-vim";

vi.mock("monaco-editor", () => ({
  KeyCode: { KeyZ: 56, KeyY: 55 },
  KeyMod: { CtrlCmd: 2048, Shift: 1024 },
}));
vi.mock("monaco-vim", () => ({
  VimMode: { commands: { undo: vi.fn(), redo: vi.fn() }, Vim: { defineEx: vi.fn() } },
}));
vi.mock("@/features/vim/stores/vim-commands", () => ({
  parseAndExecuteVimCommand: vi.fn(),
  vimCommands: [],
}));

describe("Monaco and Vim history commands", () => {
  it("routes Monaco action triggers and shortcuts through the same owned history operation", async () => {
    const actions = new Map<string, editor.IActionDescriptor>();
    const apply = vi.fn();
    const disposable = registerMonacoHistoryActions(
      {
        addAction: (action) => {
          actions.set(action.id, action);
          return { dispose: () => actions.delete(action.id) };
        },
      },
      apply,
    );
    const editorInstance = {} as editor.IStandaloneCodeEditor;
    await actions.get("undo")?.run(editorInstance);
    await actions.get("redo")?.run(editorInstance);
    expect(apply.mock.calls).toEqual([["undo"], ["redo"]]);
    expect(actions.get("undo")?.keybindingContext).toBe("editorTextFocus");
    expect(actions.get("undo")?.precondition).toBe("!editorReadonly");
    expect(actions.get("redo")?.precondition).toBe("!editorReadonly");
    disposable.dispose();
    expect(actions.size).toBe(0);
  });
  it("routes Vim Undo and Redo to the invoking editor action instead of its disposable model stack", () => {
    registerMonacoVimCommands();
    const trigger = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const cm = { editor: { trigger, getModel: () => ({ undo, redo }) } };
    VimMode.commands.undo(cm);
    VimMode.commands.redo(cm);
    expect(trigger.mock.calls).toEqual([
      ["athas-vim", "undo", null],
      ["athas-vim", "redo", null],
    ]);
    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
    registerMonacoVimCommands();
    VimMode.commands.undo(cm);
    expect(trigger).toHaveBeenCalledTimes(3);
  });
});
