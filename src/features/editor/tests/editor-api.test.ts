import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { editorAPI } from "../services/editor-api";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorStateStore } from "../stores/state.store";
import { useHistoryStore } from "../stores/history.store";
import { useEditorSettingOverridesStore } from "../stores/editor-setting-overrides.store";
import { calculateCursorPositionFromContent } from "../services/position";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";

const createMockStorage = () => {
  const storage = new Map<string, string>();

  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    get length() {
      return storage.size;
    },
  };
};

const makeBuffer = (content: string, language = "typescript"): EditorContent => ({
  id: "buffer_editor_api_test",
  type: "editor",
  path: "/tmp/editor-api-test.ts",
  name: "editor-api-test.ts",
  content,
  savedContent: content,
  isDirty: false,
  isVirtual: false,
  language,
});

describe("editor API model operations", () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("localStorage", createMockStorage());
    const styleHost = { appendChild: vi.fn() };
    const documentStub = {
      activeElement: null,
      createElement: vi.fn(() => ({
        setAttribute: vi.fn(),
        appendChild: vi.fn(),
      })),
      createTextNode: vi.fn((text: string) => ({ textContent: text })),
      getElementsByTagName: vi.fn((tagName: string) => (tagName === "head" ? [styleHost] : [])),
    };

    vi.stubGlobal("window", {
      __TAURI_INTERNALS__: {
        invoke: vi.fn().mockResolvedValue([]),
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" },
        },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("HTMLTextAreaElement", class MockTextAreaElement {});
    vi.stubGlobal("document", documentStub);

    onChange.mockReset();
    editorAPI.setActiveEditorAdapter(null);
    editorAPI.setActiveFindAdapter(null);
    editorAPI.updateCursorAndSelection({ line: 0, column: 0, offset: 0 }, null);

    useBufferStore.setState({
      buffers: [makeBuffer("alpha\nbeta")],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: { line: 1, column: 2, offset: "alpha\nbe".length },
      selection: undefined,
      onChange,
    });
  });

  afterEach(() => {
    useBufferStore?.setState({
      buffers: [],
      pendingClose: null,
      closedBuffersHistory: [],
    });
    useEditorStateStore?.setState({
      cursorPosition: { line: 0, column: 0, offset: 0 },
      selection: undefined,
      multiCursorState: null,
      onChange: () => {},
    });
    useHistoryStore?.getState().actions.clearAllHistories();
    editorAPI?.setActiveEditorAdapter(null);
    editorAPI?.setActiveFindAdapter(null);
    vi.unstubAllGlobals();
  });

  it("inserts text through the editor model when no textarea owns the content", () => {
    editorAPI.insertText("X");

    expect(onChange).toHaveBeenCalledWith(
      "alpha\nbeXta",
      "alpha\nbeta",
      { line: 1, column: 2, offset: "alpha\nbe".length },
      undefined,
      { skipUndoGrouping: true },
    );
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("alpha\nbeX".length, "alpha\nbeXta"),
    );
  });

  it("delegates text edits to the active editor adapter", () => {
    const insertText = vi.fn();
    const deleteRange = vi.fn();
    const replaceRange = vi.fn();
    const selectAll = vi.fn();
    const addSelectionToNextFindMatch = vi.fn();
    const addSelectionToPreviousFindMatch = vi.fn();
    const selectAllFindMatches = vi.fn();
    const insertCursorAbove = vi.fn();
    const insertCursorBelow = vi.fn();
    const insertCursorsAtLineEnds = vi.fn();
    const removeSecondaryCursors = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();
    const range = {
      start: calculateCursorPositionFromContent(0, "alpha\nbeta"),
      end: calculateCursorPositionFromContent(5, "alpha\nbeta"),
    };

    editorAPI.setActiveEditorAdapter({
      ownerId: "monaco-test",
      insertText,
      deleteRange,
      replaceRange,
      selectAll,
      addSelectionToNextFindMatch,
      addSelectionToPreviousFindMatch,
      selectAllFindMatches,
      insertCursorAbove,
      insertCursorBelow,
      insertCursorsAtLineEnds,
      removeSecondaryCursors,
      undo,
      redo,
    });

    editorAPI.insertText("X");
    editorAPI.deleteRange(range);
    editorAPI.replaceRange(range, "Y");
    editorAPI.selectAll();
    expect(editorAPI.addSelectionToNextFindMatch()).toBe(true);
    expect(editorAPI.addSelectionToPreviousFindMatch()).toBe(true);
    expect(editorAPI.selectAllFindMatches()).toBe(true);
    editorAPI.insertCursorAbove();
    editorAPI.insertCursorBelow();
    editorAPI.insertCursorsAtLineEnds();
    editorAPI.removeSecondaryCursors();
    editorAPI.undo();
    editorAPI.redo();

    expect(insertText).toHaveBeenCalledWith("X", undefined);
    expect(deleteRange).toHaveBeenCalledWith(range);
    expect(replaceRange).toHaveBeenCalledWith(range, "Y");
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(addSelectionToNextFindMatch).toHaveBeenCalledTimes(1);
    expect(addSelectionToPreviousFindMatch).toHaveBeenCalledTimes(1);
    expect(selectAllFindMatches).toHaveBeenCalledTimes(1);
    expect(insertCursorAbove).toHaveBeenCalledTimes(1);
    expect(insertCursorBelow).toHaveBeenCalledTimes(1);
    expect(insertCursorsAtLineEnds).toHaveBeenCalledTimes(1);
    expect(removeSecondaryCursors).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("delegates find and replace to the active find adapter", () => {
    const openFind = vi.fn();
    editorAPI.setActiveFindAdapter({ ownerId: "monaco-find-test", openFind });

    expect(editorAPI.openFind()).toBe(true);
    expect(editorAPI.openFind(true)).toBe(true);
    expect(openFind).toHaveBeenNthCalledWith(1, false);
    expect(openFind).toHaveBeenNthCalledWith(2, true);

    editorAPI.clearActiveFindAdapter("another-editor");
    expect(editorAPI.openFind()).toBe(true);

    editorAPI.clearActiveFindAdapter("monaco-find-test");
    expect(editorAPI.openFind()).toBe(false);
  });

  it("clears only the matching active editor adapter", () => {
    const firstInsert = vi.fn();
    const secondInsert = vi.fn();
    const noopAdapter = {
      deleteRange: vi.fn(),
      replaceRange: vi.fn(),
      selectAll: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };

    editorAPI.setActiveEditorAdapter({
      ownerId: "first",
      insertText: firstInsert,
      ...noopAdapter,
    });
    editorAPI.setActiveEditorAdapter({
      ownerId: "second",
      insertText: secondInsert,
      ...noopAdapter,
    });

    editorAPI.clearActiveEditorAdapter("first");
    editorAPI.insertText("X");
    expect(firstInsert).not.toHaveBeenCalled();
    expect(secondInsert).toHaveBeenCalledTimes(1);

    editorAPI.clearActiveEditorAdapter("second");
    editorAPI.insertText("Y");
    expect(onChange).toHaveBeenCalledWith(
      "alpha\nbeYta",
      "alpha\nbeta",
      { line: 1, column: 2, offset: "alpha\nbe".length },
      undefined,
      { skipUndoGrouping: true },
    );
  });

  it("selects the full model content without relying on a native textarea selection", () => {
    editorAPI.selectAll();

    expect(useEditorStateStore.getState().selection).toEqual({
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 1, column: 4, offset: "alpha\nbeta".length },
    });
  });

  it("reads cursor and selection from the editor model store", () => {
    const selection = {
      start: calculateCursorPositionFromContent(0, "alpha\nbeta"),
      end: calculateCursorPositionFromContent(5, "alpha\nbeta"),
    };
    useEditorStateStore.setState({
      cursorPosition: selection.end,
      selection,
    });

    expect(editorAPI.getCursorPosition()).toEqual(selection.end);
    expect(editorAPI.getSelection()).toEqual(selection);
  });

  it("toggles comments through the model path", () => {
    useEditorStateStore.setState({
      cursorPosition: { line: 0, column: 1, offset: 1 },
      selection: undefined,
    });

    editorAPI.toggleComment();

    expect(onChange).toHaveBeenCalledWith(
      "// alpha\nbeta",
      "alpha\nbeta",
      { line: 0, column: 1, offset: 1 },
      undefined,
      { skipUndoGrouping: true },
    );
  });

  it("jumps between brackets through the model cursor", () => {
    const content = "fn call(value)";
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: calculateCursorPositionFromContent("fn call(".length, content),
      selection: {
        start: calculateCursorPositionFromContent(0, content),
        end: calculateCursorPositionFromContent(2, content),
      },
    });

    editorAPI.goToMatchingBracket();

    expect(useEditorStateStore.getState().selection).toBeUndefined();
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("fn call(value".length, content),
    );

    editorAPI.goToMatchingBracket();

    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("fn call".length, content),
    );
  });

  it("selects to the nearest bracket pair through the model cursor", () => {
    const content = "fn call(value)";
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: calculateCursorPositionFromContent("fn call(va".length, content),
      selection: undefined,
    });

    editorAPI.selectToBracket(false);

    expect(useEditorStateStore.getState().selection).toEqual({
      start: calculateCursorPositionFromContent("fn call(".length, content),
      end: calculateCursorPositionFromContent("fn call(value".length, content),
    });
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("fn call(value".length, content),
    );
  });

  it("removes the nearest bracket pair through the model edit path", () => {
    const content = "var x = (3 + (5-7));";
    const nextContent = "var x = (3 + 5-7);";
    const cursor = calculateCursorPositionFromContent("var x = (3 + (5".length, content);
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: cursor,
      selection: undefined,
    });

    editorAPI.removeBrackets();

    expect(onChange).toHaveBeenCalledWith(nextContent, content, cursor, undefined, {
      skipUndoGrouping: true,
    });
    expect(useEditorStateStore.getState().selection).toBeUndefined();
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("var x = (3 + 5".length, nextContent),
    );
  });

  it("expands and shrinks smart selection ranges through the model cursor", () => {
    const content = "const value = call(alpha);\nnext();";
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: calculateCursorPositionFromContent("const value = call(al".length, content),
      selection: undefined,
    });

    editorAPI.expandSelection();

    expect(useEditorStateStore.getState().selection).toEqual({
      start: calculateCursorPositionFromContent("const value = call(".length, content),
      end: calculateCursorPositionFromContent("const value = call(alpha".length, content),
    });

    editorAPI.expandSelection();

    expect(useEditorStateStore.getState().selection).toEqual({
      start: calculateCursorPositionFromContent("const value = call".length, content),
      end: calculateCursorPositionFromContent("const value = call(alpha)".length, content),
    });

    editorAPI.shrinkSelection();

    expect(useEditorStateStore.getState().selection).toEqual({
      start: calculateCursorPositionFromContent("const value = call(".length, content),
      end: calculateCursorPositionFromContent("const value = call(alpha".length, content),
    });
  });

  it("adds vertical cursors through the model API without stealing the primary cursor", () => {
    const content = "one\nlonger\nx";
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: calculateCursorPositionFromContent("one\nlong".length, content),
      selection: undefined,
      multiCursorState: null,
    });

    editorAPI.insertCursorBelow();

    const multiCursorState = useEditorStateStore.getState().multiCursorState;
    expect(multiCursorState?.cursors.map((cursor) => cursor.position)).toEqual([
      calculateCursorPositionFromContent("one\nlong".length, content),
      calculateCursorPositionFromContent("one\nlonger\nx".length, content),
    ]);
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("one\nlong".length, content),
    );

    editorAPI.insertCursorAbove();

    expect(useEditorStateStore.getState().multiCursorState?.cursors).toHaveLength(3);

    editorAPI.removeSecondaryCursors();

    expect(useEditorStateStore.getState().multiCursorState?.cursors).toHaveLength(1);
  });

  it("adds cursors to selected line ends through the model API", () => {
    const content = "one\ntwo\nthree";
    useBufferStore.setState({
      buffers: [makeBuffer(content)],
    });
    seedActiveBuffer("buffer_editor_api_test");
    useEditorStateStore.setState({
      cursorPosition: calculateCursorPositionFromContent("one\ntwo\nth".length, content),
      selection: {
        start: calculateCursorPositionFromContent(1, content),
        end: calculateCursorPositionFromContent("one\ntwo\nth".length, content),
      },
      multiCursorState: null,
    });

    editorAPI.insertCursorsAtLineEnds();

    expect(useEditorStateStore.getState().selection).toBeUndefined();
    expect(
      useEditorStateStore.getState().multiCursorState?.cursors.map((cursor) => cursor.position),
    ).toEqual([
      calculateCursorPositionFromContent("one".length, content),
      calculateCursorPositionFromContent("one\ntwo".length, content),
      calculateCursorPositionFromContent("one\ntwo\nth".length, content),
    ]);
  });

  it("replaces the selected range through the model path", () => {
    const start = calculateCursorPositionFromContent("alpha\n".length, "alpha\nbeta");
    const end = calculateCursorPositionFromContent("alpha\nbet".length, "alpha\nbeta");

    editorAPI.replaceRange({ start, end }, "B");

    expect(onChange).toHaveBeenCalledWith(
      "alpha\nBa",
      "alpha\nbeta",
      { line: 1, column: 2, offset: "alpha\nbe".length },
      undefined,
      { skipUndoGrouping: true },
    );
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("alpha\nB".length, "alpha\nBa"),
    );
  });

  it("reads individual lines from large documents", () => {
    const largeContent = Array.from({ length: 50_001 }, (_, index) => `line-${index}`).join("\n");
    useBufferStore.setState({
      buffers: [makeBuffer(largeContent, "txt")],
    });
    seedActiveBuffer("buffer_editor_api_test");

    expect(editorAPI.getLineCount()).toBe(50_001);
    expect(editorAPI.getLines()).toHaveLength(50_001);
    expect(editorAPI.getLine(50_000)).toBe("line-50000");
    expect(editorAPI.getLine(50_001)).toBeUndefined();
  });

  it("reports the active editor theme from settings", () => {
    const previousSettings = useSettingsStore.getState().settings;
    useSettingsStore.setState({
      settings: { ...previousSettings, theme: "one-dark", syncSystemTheme: false },
    });

    try {
      expect(editorAPI.getSettings().theme).toBe("one-dark");
    } finally {
      useSettingsStore.setState({ settings: previousSettings });
    }
  });

  it("applies extension setting changes for the session without saving them", () => {
    const previousSettings = useSettingsStore.getState().settings;
    const updateSetting = vi.spyOn(useSettingsStore.getState().actions, "updateSetting");
    const onSettingsChange = vi.fn();
    const unsubscribe = editorAPI.on("settingsChange", onSettingsChange);
    useSettingsStore.setState({
      settings: { ...previousSettings, fontSize: 14, wordWrap: false, horizontalTabScroll: true },
    });

    try {
      editorAPI.updateSettings({ fontSize: 20, wordWrap: false });

      expect(updateSetting).not.toHaveBeenCalled();
      expect(useSettingsStore.getState().settings.fontSize).toBe(14);
      expect(editorAPI.getSettings()).toMatchObject({ fontSize: 20, wordWrap: false });
      expect(onSettingsChange).toHaveBeenCalledWith({ fontSize: 20, wordWrap: false });

      useSettingsStore.setState({
        settings: { ...useSettingsStore.getState().settings, showMinimap: false },
      });
      expect(editorAPI.getSettings()).toMatchObject({ fontSize: 20, wordWrap: false });

      editorAPI.clearSettingOverrides();
      expect(useEditorSettingOverridesStore.getState().overrides).toEqual({});
      expect(editorAPI.getSettings()).toMatchObject({ fontSize: 14, wordWrap: true });
      expect(onSettingsChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ fontSize: 14, wordWrap: true }),
      );
    } finally {
      unsubscribe();
      updateSetting.mockRestore();
      useEditorSettingOverridesStore.getState().actions.clearOverrides();
      useSettingsStore.setState({ settings: previousSettings });
    }
  });

  it("restores the previous content on undo", () => {
    useHistoryStore.getState().actions.pushHistory("buffer_editor_api_test", {
      content: "alpha",
      cursorPosition: { line: 0, column: 5, offset: 5 },
      timestamp: Date.now(),
    });

    editorAPI.undo();

    expect(useBufferStore.getState().actions.getActiveBuffer()).toMatchObject({
      content: "alpha",
    });
  });
});
