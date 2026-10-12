// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { useKeybindingConflicts } from "../hooks/use-keybinding-conflicts";
import { useKeybindingRecorder } from "../hooks/use-keybinding-recorder";
import { useKeymapContext } from "../hooks/use-keymap-context";
import { keymapRegistry } from "../services/keymap-registry";
import { useKeymapStore } from "../stores/keymaps.store";

function renderHook<T>(useHook: () => T) {
  const result = {} as { current: T };
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { result, unmount: () => act(() => root.unmount()) };
}

function press(init: KeyboardEventInit) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const contexts = () => useKeymapStore.getState().contexts;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useKeymapStore.setState({ keybindings: [], recordingCommandId: null });
  useKeymapStore.getState().actions.setContexts({
    editorFocus: false,
    terminalFocus: false,
    hasSelection: false,
    isRecordingKeybinding: false,
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("keybinding recorder", () => {
  it("records a key combination while recording for its command", () => {
    const { result, unmount } = renderHook(() => useKeybindingRecorder("editor.save"));
    expect(result.current.isRecording).toBe(false);

    act(() => result.current.startRecording());
    expect(result.current.isRecording).toBe(true);
    expect(contexts().isRecordingKeybinding).toBe(true);

    press({ key: "Shift", shiftKey: true });
    expect(result.current.keybindingString).toBe("");

    const event = press({ key: "k", code: "KeyK", ctrlKey: true, shiftKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.keybindingString).toBe("ctrl+shift+k");
    expect(result.current.keys.length).toBeGreaterThan(1);

    press({ key: "Enter" });
    expect(result.current.isRecording).toBe(false);
    expect(result.current.keybindingString).toBe("ctrl+shift+k");
    unmount();
  });

  it("stops on Escape and clears the recording on reset", () => {
    const { result, unmount } = renderHook(() => useKeybindingRecorder("editor.save"));
    act(() => result.current.startRecording());
    press({ key: "p", code: "KeyP", altKey: true });

    press({ key: "Escape" });
    expect(result.current.isRecording).toBe(false);

    act(() => result.current.startRecording());
    press({ key: "j", code: "KeyJ", altKey: true });
    act(() => result.current.reset());
    expect(result.current).toMatchObject({ isRecording: false, keybindingString: "", keys: [] });
    unmount();
  });

  it("ignores keys while another command records and stops its own recording on unmount", () => {
    const other = renderHook(() => useKeybindingRecorder("other.command"));
    const { result, unmount } = renderHook(() => useKeybindingRecorder("editor.save"));

    act(() => other.result.current.startRecording());
    press({ key: "x", code: "KeyX", ctrlKey: true });
    expect(result.current.keybindingString).toBe("");
    expect(other.result.current.keybindingString).toBe("ctrl+x");

    act(() => result.current.startRecording());
    unmount();
    expect(useKeymapStore.getState().recordingCommandId).toBeNull();

    act(() => other.result.current.startRecording());
    act(() => other.result.current.stopRecording());
    expect(useKeymapStore.getState().recordingCommandId).toBeNull();
    other.unmount();
  });
});

describe("keybinding conflicts", () => {
  beforeEach(() => {
    for (const id of ["files.save", "files.saveAll", "terminal.clear"]) {
      keymapRegistry.registerCommand({ id, title: id, execute: () => {} });
    }
    useKeymapStore.setState({
      keybindings: [
        { key: "cmd+s", command: "files.save", source: "user", enabled: true },
        { key: "cmd+s", command: "files.saveAll", source: "user", enabled: false },
        {
          key: "cmd+k",
          command: "terminal.clear",
          when: "terminalFocus",
          source: "user",
          enabled: true,
        },
        { key: "cmd+s", command: "unregistered.command", source: "user", enabled: true },
      ],
    });
  });

  afterEach(() => {
    for (const id of ["files.save", "files.saveAll", "terminal.clear"]) {
      keymapRegistry.unregisterCommand(id);
    }
  });

  it("lists enabled, registered commands on the same key and context", () => {
    const { result, unmount } = renderHook(() => useKeybindingConflicts("cmd+s", "editor.format"));
    expect(result.current.hasConflict).toBe(true);
    expect(result.current.conflictingCommands.map((command) => command.id)).toEqual(["files.save"]);
    unmount();
  });

  it("does not conflict with itself, other contexts or an empty key", () => {
    const self = renderHook(() => useKeybindingConflicts("cmd+s", "files.save"));
    expect(self.result.current.hasConflict).toBe(false);

    const otherContext = renderHook(() => useKeybindingConflicts("cmd+k", "x", "editorFocus"));
    expect(otherContext.result.current.hasConflict).toBe(false);

    const sameContext = renderHook(() => useKeybindingConflicts("cmd+k", "x", "terminalFocus"));
    expect(sameContext.result.current.conflictingCommands.map((command) => command.id)).toEqual([
      "terminal.clear",
    ]);

    const empty = renderHook(() => useKeybindingConflicts("", "x"));
    expect(empty.result.current).toEqual({ hasConflict: false, conflictingCommands: [] });
  });
});

describe("keymap contexts", () => {
  it("tracks vim modes from settings and the vim store", () => {
    void useSettingsStore.getState().actions.updateSetting("vimMode", true);
    act(() => useVimStore.getState().actions.setMode("insert"));
    const { unmount } = renderHook(() => useKeymapContext());

    expect(contexts()).toMatchObject({
      vimMode: true,
      vimInsertMode: true,
      vimNormalMode: false,
      vimVisualMode: false,
    });

    act(() => useVimStore.getState().actions.setMode("visual"));
    expect(contexts()).toMatchObject({ vimVisualMode: true, vimInsertMode: false });

    act(() => void useSettingsStore.getState().actions.updateSetting("vimMode", false));
    expect(contexts()).toMatchObject({ vimMode: false, vimVisualMode: false });
    unmount();
  });

  it("tracks editor and terminal focus as focus moves", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useKeymapContext());
    const editor = document.createElement("div");
    editor.setAttribute("data-editor-engine", "codemirror");
    editor.innerHTML = '<div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>';
    const terminal = document.createElement("div");
    terminal.className = "terminal-container";
    terminal.innerHTML = '<textarea aria-label="terminal input"></textarea>';
    document.body.append(editor, terminal);
    const editorContent = editor.querySelector<HTMLElement>(".cm-content")!;
    const terminalInput = terminal.querySelector("textarea")!;

    act(() => editorContent.focus());
    expect(contexts()).toMatchObject({ editorFocus: true, terminalFocus: false });

    act(() => terminalInput.focus());
    expect(contexts()).toMatchObject({ editorFocus: false, terminalFocus: true });

    act(() => {
      terminalInput.blur();
      vi.runAllTimers();
    });
    expect(contexts()).toMatchObject({ editorFocus: false, terminalFocus: false });
    unmount();
  });

  it("tracks whether the document has a selection", () => {
    const { unmount } = renderHook(() => useKeymapContext());
    const paragraph = document.createElement("p");
    paragraph.textContent = "select me";
    document.body.appendChild(paragraph);

    act(() => {
      window.getSelection()!.selectAllChildren(paragraph);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(contexts().hasSelection).toBe(true);

    act(() => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(contexts().hasSelection).toBe(false);
    unmount();
  });
});
