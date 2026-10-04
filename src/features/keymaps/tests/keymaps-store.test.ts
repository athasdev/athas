// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Keybinding } from "../types/keymaps.types";

const { actions } = useKeymapStore.getState();

afterEach(() => {
  actions.resetToDefaults();
  actions.stopRecording();
  actions.setContexts({ editorFocus: false, vimMode: false });
  localStorage.clear();
});

describe("keymap store", () => {
  it("keeps a single user keybinding per command", () => {
    actions.addKeybinding({ key: "cmd+s", command: "file.save", source: "user" });
    actions.addKeybinding({ key: "cmd+o", command: "file.open", source: "user" });
    actions.addKeybinding({ key: " cmd+alt+s ", command: "file.save", source: "user" });

    expect(useKeymapStore.getState().keybindings).toEqual([
      { key: "cmd+o", command: "file.open", source: "user", enabled: true },
      { key: "cmd+alt+s", command: "file.save", source: "user", enabled: true },
    ]);
  });

  it("rejects keybindings without a key or command", () => {
    actions.addKeybinding({ key: "  ", command: "file.save", source: "user" });
    actions.addKeybinding({ key: "cmd+s", command: "", source: "user" });

    expect(useKeymapStore.getState().keybindings).toEqual([]);
  });

  it("removes and resets user keybindings", () => {
    actions.addKeybinding({ key: "cmd+s", command: "file.save", source: "user" });
    actions.addKeybinding({ key: "cmd+o", command: "file.open", source: "user" });

    actions.removeKeybinding("file.save");
    expect(useKeymapStore.getState().keybindings.map((kb) => kb.command)).toEqual(["file.open"]);

    actions.resetToDefaults();
    expect(useKeymapStore.getState().keybindings).toEqual([]);
  });

  it("merges imports, replacing every existing rule for an imported command", () => {
    actions.addKeybinding({ key: "cmd+s", command: "file.save", source: "user" });
    actions.addKeybinding({ key: "cmd+o", command: "file.open", source: "user" });
    const imported: Keybinding[] = [
      { key: "ctrl+s", command: "file.save", source: "user" },
      { key: "ctrl+alt+s", command: "file.save", when: "editorFocus", source: "user" },
    ];

    actions.importKeybindings(imported);

    expect(useKeymapStore.getState().keybindings.map((kb) => [kb.command, kb.key])).toEqual([
      ["file.save", "ctrl+s"],
      ["file.save", "ctrl+alt+s"],
      ["file.open", "cmd+o"],
    ]);
  });

  it("does not notify subscribers when a context value is unchanged", () => {
    const listener = vi.fn();
    const unsubscribe = useKeymapStore.subscribe(listener);

    actions.setContext("editorFocus", false);
    actions.setContexts({ editorFocus: false, vimMode: false });
    expect(listener).not.toHaveBeenCalled();

    actions.setContext("editorFocus", true);
    actions.setContexts({ editorFocus: true, vimMode: true });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(useKeymapStore.getState().contexts).toMatchObject({ editorFocus: true, vimMode: true });

    unsubscribe();
  });

  it("flags the recording context while a keybinding is being recorded", () => {
    actions.startRecording("file.save");
    expect(useKeymapStore.getState()).toMatchObject({
      recordingCommandId: "file.save",
      contexts: { isRecordingKeybinding: true },
    });

    actions.stopRecording();
    expect(useKeymapStore.getState()).toMatchObject({
      recordingCommandId: null,
      contexts: { isRecordingKeybinding: false },
    });
  });

  it("persists user keybindings but not focus contexts", () => {
    actions.addKeybinding({ key: "cmd+s", command: "file.save", source: "user" });
    actions.setContext("editorFocus", true);

    const persisted = JSON.parse(localStorage.getItem("keymaps-storage") ?? "{}");

    expect(persisted.state).toEqual({
      keybindings: [{ key: "cmd+s", command: "file.save", source: "user", enabled: true }],
    });
  });
});
