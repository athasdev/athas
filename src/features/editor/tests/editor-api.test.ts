import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { editorAPI as editorAPIInstance } from "../extensions/api";
import type { useBufferStore as useBufferStoreHook } from "../stores/buffer.store";
import type { useEditorStateStore as useEditorStateStoreHook } from "../stores/state.store";
import type { useHistoryStore as useHistoryStoreHook } from "../stores/history.store";
import type { useEditorSettingsStore as useEditorSettingsStoreHook } from "../stores/settings.store";
import { calculateCursorPositionFromContent } from "../utils/position";
import type { EditorContent } from "@/features/panes/types/pane-content.types";

type EditorAPIInstance = typeof editorAPIInstance;
type BufferStoreHook = typeof useBufferStoreHook;
type EditorStateStoreHook = typeof useEditorStateStoreHook;
type HistoryStoreHook = typeof useHistoryStoreHook;
type EditorSettingsStoreHook = typeof useEditorSettingsStoreHook;

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
  isPinned: false,
  isPreview: false,
  isActive: true,
  language,
  tokens: [],
});

describe("editor API model operations", () => {
  const onChange = vi.fn();
  let editorAPI: EditorAPIInstance;
  let useBufferStore: BufferStoreHook;
  let useEditorStateStore: EditorStateStoreHook;
  let useHistoryStore: HistoryStoreHook;
  let useEditorSettingsStore: EditorSettingsStoreHook;

  beforeEach(async () => {
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

    ({ editorAPI } = await import("../extensions/api"));
    ({ useBufferStore } = await import("../stores/buffer.store"));
    ({ useEditorStateStore } = await import("../stores/state.store"));
    ({ useHistoryStore } = await import("../stores/history.store"));
    ({ useEditorSettingsStore } = await import("../stores/settings.store"));

    onChange.mockReset();
    editorAPI.setTextareaRef?.(null);
    editorAPI.setActiveEditorAdapter(null);
    editorAPI.updateCursorAndSelection({ line: 0, column: 0, offset: 0 }, null);

    useBufferStore.setState({
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer("alpha\nbeta")],
    });
    useEditorStateStore.setState({
      cursorPosition: { line: 1, column: 2, offset: "alpha\nbe".length },
      selection: undefined,
      onChange,
    });
  });

  afterEach(() => {
    useBufferStore?.setState({
      activeBufferId: null,
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
    useEditorSettingsStore?.setState({ theme: "athas-dark" });
    editorAPI?.setActiveEditorAdapter(null);
    vi.unstubAllGlobals();
  });

  it("inserts text through the editor model when no textarea owns the content", () => {
    editorAPI.insertText("X");

    expect(onChange).toHaveBeenCalledWith(
      "alpha\nbeXta",
      "alpha\nbeta",
      { line: 1, column: 2, offset: "alpha\nbe".length },
      undefined,
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
    editorAPI.undo();
    editorAPI.redo();

    expect(insertText).toHaveBeenCalledWith("X", undefined);
    expect(deleteRange).toHaveBeenCalledWith(range);
    expect(replaceRange).toHaveBeenCalledWith(range, "Y");
    expect(selectAll).toHaveBeenCalledTimes(1);
    expect(addSelectionToNextFindMatch).toHaveBeenCalledTimes(1);
    expect(addSelectionToPreviousFindMatch).toHaveBeenCalledTimes(1);
    expect(selectAllFindMatches).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
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
    );
  });

  it("jumps between brackets through the model cursor", () => {
    const content = "fn call(value)";
    useBufferStore.setState({
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
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
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
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
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
    useEditorStateStore.setState({
      cursorPosition: cursor,
      selection: undefined,
    });

    editorAPI.removeBrackets();

    expect(onChange).toHaveBeenCalledWith(nextContent, content, cursor, undefined);
    expect(useEditorStateStore.getState().selection).toBeUndefined();
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("var x = (3 + 5".length, nextContent),
    );
  });

  it("expands and shrinks smart selection ranges through the model cursor", () => {
    const content = "const value = call(alpha);\nnext();";
    useBufferStore.setState({
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
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
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
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
  });

  it("adds cursors to selected line ends through the model API", () => {
    const content = "one\ntwo\nthree";
    useBufferStore.setState({
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(content)],
    });
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
    );
    expect(useEditorStateStore.getState().cursorPosition).toEqual(
      calculateCursorPositionFromContent("alpha\nB".length, "alpha\nBa"),
    );
  });

  it("reads individual lines from sparse large-file view state", () => {
    const largeContent = Array.from({ length: 50_001 }, (_, index) => `line-${index}`).join("\n");
    useBufferStore.setState({
      activeBufferId: "buffer_editor_api_test",
      buffers: [makeBuffer(largeContent, "txt")],
    });

    expect(editorAPI.getLineCount()).toBe(50_001);
    expect(editorAPI.getLines()).toHaveLength(50_001);
    expect(Object.keys(editorAPI.getLines())).toHaveLength(0);
    expect(editorAPI.getLine(50_000)).toBe("line-50000");
    expect(editorAPI.getLine(50_001)).toBeUndefined();
  });

  it("reports the active editor theme from editor settings", () => {
    useEditorSettingsStore.setState({ theme: "one-dark" });

    expect(editorAPI.getSettings().theme).toBe("one-dark");
  });

  it("does not sync cursor offsets into a textarea that does not own the full content", () => {
    const textarea = {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      dispatchEvent: vi.fn(),
      select: vi.fn(),
    } as unknown as HTMLTextAreaElement;

    editorAPI.setTextareaRef?.(textarea);
    editorAPI.setCursorPosition({ line: 1, column: 4, offset: "alpha\nbeta".length });

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(0);

    textarea.value = "alpha\nbeta";
    editorAPI.setCursorPosition({ line: 0, column: 2, offset: 2 });

    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it("does not write undo content into a textarea that does not own the full content", () => {
    const textarea = {
      value: "",
      selectionStart: 0,
      selectionEnd: 0,
      dispatchEvent: vi.fn(),
      select: vi.fn(),
    } as unknown as HTMLTextAreaElement;

    editorAPI.setTextareaRef?.(textarea);
    useHistoryStore.getState().actions.pushHistory("buffer_editor_api_test", {
      content: "alpha",
      cursorPosition: { line: 0, column: 5, offset: 5 },
      timestamp: Date.now(),
    });

    editorAPI.undo();

    expect(useBufferStore.getState().actions.getActiveBuffer()).toMatchObject({
      content: "alpha",
    });
    expect(textarea.value).toBe("");
  });
});
