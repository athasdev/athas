// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DiagnosticCodeAction } from "@/features/diagnostics/types/diagnostics.types";
import { editorAPI, type ActiveEditorAdapter } from "@/features/editor/services/editor-api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { onAppEvent } from "@/utils/app-events";
import { useFoldStore } from "@/features/editor/stores/fold.store";
import { useInlineEditToolbarStore } from "@/features/editor/stores/inline-edit-toolbar.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import type { Range } from "@/features/editor/types/editor.types";
import { calculateCursorPositionFromContent } from "@/features/editor/services/position";
import type { EditorContent, PaneContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import {
  copyActiveEditorLineDown,
  copyActiveEditorLineUp,
  copyActiveEditorSelection,
  cutActiveEditorSelection,
  deleteActiveEditorLine,
  duplicateActiveEditorLine,
  expandActiveEditorSelection,
  foldAllActiveEditor,
  foldLevelActiveEditor,
  formatActiveEditorDocument,
  formatActiveEditorSelection,
  goToActiveEditorMatchingBracket,
  insertActiveEditorCursorAbove,
  insertActiveEditorCursorBelow,
  insertActiveEditorCursorsAtLineEnds,
  moveActiveEditorLineDown,
  moveActiveEditorLineUp,
  pasteIntoActiveEditor,
  redoActiveEditor,
  removeActiveEditorBrackets,
  removeActiveEditorSecondaryCursors,
  runQuickFixForActiveEditor,
  selectAllActiveEditor,
  selectAllEditorOccurrences,
  selectNextEditorOccurrence,
  selectPreviousEditorOccurrence,
  selectToActiveEditorBracket,
  showHoverForActiveEditor,
  showInlineEditToolbar,
  shrinkActiveEditorSelection,
  toggleActiveEditorComment,
  triggerActiveEditorParameterHints,
  triggerActiveEditorRenameSymbol,
  triggerActiveEditorSuggest,
  undoActiveEditor,
  unfoldAllActiveEditor,
} from "../commands/editor-command-actions";

const mocks = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });

  return {
    clipboard: { text: "" },
    toast: {
      success: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    },
    showChoiceDialog: vi.fn(),
    formatContent: vi.fn(),
    formatRange: vi.fn(),
    isFormattingAvailable: vi.fn(),
    getCodeActions: vi.fn(),
    applyCodeAction: vi.fn(),
    imageSessions: new Map<string, { undo: () => void; redo: () => void }>(),
  };
});

vi.mock("@/features/editor/services/editor-clipboard", () => ({
  readEditorClipboardText: async () => mocks.clipboard.text,
  writeEditorClipboardText: async (text: string) => {
    mocks.clipboard.text = text;
  },
}));

vi.mock("sonner", () => ({ toast: mocks.toast }));

vi.mock("@/ui/dialog", () => ({ showChoiceDialog: mocks.showChoiceDialog }));

vi.mock("@/features/editor/services/formatter-service", () => ({
  formatContent: mocks.formatContent,
  formatRange: mocks.formatRange,
  isFormattingAvailable: mocks.isFormattingAvailable,
}));

vi.mock("@/features/editor/lsp/services/lsp-client", () => ({
  LspClient: {
    getInstance: () => ({
      getCodeActions: mocks.getCodeActions,
      applyCodeAction: mocks.applyCodeAction,
    }),
  },
}));

vi.mock("@/features/viewer/image/editor/services/image-buffer-session", () => ({
  getImageBufferSession: (_owner: unknown, bufferId: string) =>
    mocks.imageSessions.get(bufferId) ?? null,
}));

const BUFFER_ID = "buffer-editor-commands";
const FILE_PATH = "/workspace/editor-commands.ts";

function makeEditorBuffer(content: string, overrides: Partial<EditorContent> = {}): EditorContent {
  return {
    id: BUFFER_ID,
    type: "editor",
    path: FILE_PATH,
    name: "editor-commands.ts",
    content,
    savedContent: content,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
    ...overrides,
  };
}

function openDocument(content: string, cursorOffset = 0, overrides: Partial<EditorContent> = {}) {
  useBufferStore.setState({ buffers: [makeEditorBuffer(content, overrides)] });
  seedActiveBuffer(BUFFER_ID);
  useEditorStateStore.setState({
    cursorPosition: calculateCursorPositionFromContent(cursorOffset, content),
    selection: undefined,
    multiCursorState: null,
  });
}

function openBuffers(buffers: PaneContent[], activeBufferId: string | null) {
  useBufferStore.setState({ buffers });
  seedActiveBuffer(activeBufferId);
}

function getDocument(): string {
  const buffer = useBufferStore.getState().buffers.find((item) => item.id === BUFFER_ID);
  return buffer && "content" in buffer && typeof buffer.content === "string" ? buffer.content : "";
}

function rangeOf(content: string, start: number, end: number): Range {
  return {
    start: calculateCursorPositionFromContent(start, content),
    end: calculateCursorPositionFromContent(end, content),
  };
}

function selectOffsets(start: number, end: number) {
  const content = getDocument();
  useEditorStateStore.setState({
    selection: rangeOf(content, start, end),
    cursorPosition: calculateCursorPositionFromContent(end, content),
  });
}

function selectedOffsets() {
  const selection = useEditorStateStore.getState().selection;
  return selection ? { start: selection.start.offset, end: selection.end.offset } : null;
}

function cursorSelections() {
  return (
    useEditorStateStore
      .getState()
      .multiCursorState?.cursors.map((cursor) =>
        cursor.selection
          ? [cursor.selection.start.offset, cursor.selection.end.offset]
          : [cursor.position.offset],
      ) ?? []
  );
}

function focusTextInput() {
  const input = document.createElement("input");
  document.body.appendChild(input);
  input.focus();
  return input;
}

function createAdapter(overrides: Partial<ActiveEditorAdapter> = {}): ActiveEditorAdapter {
  return {
    ownerId: "editor-command-actions-test",
    insertText: vi.fn(),
    deleteRange: vi.fn(),
    replaceRange: vi.fn(),
    selectAll: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...overrides,
  };
}

function codeAction(title: string, overrides: Partial<DiagnosticCodeAction> = {}) {
  return {
    id: title,
    title,
    isPreferred: false,
    hasCommand: false,
    hasEdit: true,
    payload: { title },
    ...overrides,
  } satisfies DiagnosticCodeAction;
}

const execCommand = vi.fn();

beforeEach(async () => {
  workspaceRuntimeRegistry.resetForTests();
  mocks.clipboard.text = "";
  mocks.imageSessions.clear();
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: execCommand,
  });
  editorAPI.setActiveEditorAdapter(null);
  useEditorStateStore.setState({
    cursorPosition: { line: 0, column: 0, offset: 0 },
    selection: undefined,
    multiCursorState: null,
    activeEditorViewKey: null,
    onChange: (next: string) => {
      useBufferStore.setState((state) => ({
        buffers: state.buffers.map((buffer) =>
          buffer.id === BUFFER_ID ? { ...buffer, content: next } : buffer,
        ),
      }));
    },
  });
  useInlineEditToolbarStore.setState({ isVisible: false, targetViewKey: null, requestId: 0 });
  useFoldStore.setState({ foldsByFile: new Map() });
  const { useDiagnosticsStore } = await import("@/features/diagnostics/stores/diagnostics.store");
  useDiagnosticsStore.getState().actions.clearAllDiagnostics();
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
  editorAPI.setActiveEditorAdapter(null);
  useBufferStore.setState({
    buffers: [],
    pendingClose: null,
    closedBuffersHistory: [],
  });
  seedActiveBuffer(null);
  vi.clearAllMocks();
});

describe("select all", () => {
  it("selects the whole document in the editor model", () => {
    openDocument("alpha\nbeta", 2);

    selectAllActiveEditor();

    expect(selectedOffsets()).toEqual({ start: 0, end: "alpha\nbeta".length });
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("leaves focused text fields to the native select-all", () => {
    openDocument("alpha", 0);
    focusTextInput();

    selectAllActiveEditor();

    expect(execCommand).toHaveBeenCalledWith("selectAll");
    expect(selectedOffsets()).toBeNull();
  });

  it("selects only the rendered markdown when the preview has focus", () => {
    openDocument("# Title", 0);
    const preview = document.createElement("div");
    preview.setAttribute("data-markdown-preview", "");
    preview.tabIndex = 0;
    preview.innerHTML = '<nav>toolbar</nav><div class="markdown-content">Rendered body</div>';
    document.body.appendChild(preview);
    preview.focus();

    selectAllActiveEditor();

    expect(window.getSelection()?.toString()).toBe("Rendered body");
    expect(selectedOffsets()).toBeNull();
  });

  it("does nothing when the focused preview has no rendered content", () => {
    openDocument("# Title", 0);
    const preview = document.createElement("div");
    preview.setAttribute("data-markdown-preview", "");
    preview.tabIndex = 0;
    document.body.appendChild(preview);
    preview.focus();

    selectAllActiveEditor();

    expect(window.getSelection()?.toString()).toBe("");
    expect(execCommand).not.toHaveBeenCalled();
    expect(selectedOffsets()).toBeNull();
  });
});

describe("undo and redo", () => {
  it("routes history to the image editing session when an image is active", () => {
    const session = { undo: vi.fn(), redo: vi.fn() };
    mocks.imageSessions.set("image-1", session);
    const adapter = createAdapter();
    editorAPI.setActiveEditorAdapter(adapter);
    openBuffers(
      [
        {
          id: "image-1",
          type: "image",
          path: "/workspace/logo.png",
          name: "logo.png",
        },
      ],
      "image-1",
    );

    undoActiveEditor();
    redoActiveEditor();

    expect(session.undo).toHaveBeenCalledOnce();
    expect(session.redo).toHaveBeenCalledOnce();
    expect(adapter.undo).not.toHaveBeenCalled();
    expect(adapter.redo).not.toHaveBeenCalled();
  });

  it("routes history to the text editor for editor buffers", () => {
    const adapter = createAdapter();
    editorAPI.setActiveEditorAdapter(adapter);
    openDocument("text", 0);

    undoActiveEditor();
    redoActiveEditor();

    expect(adapter.undo).toHaveBeenCalledOnce();
    expect(adapter.redo).toHaveBeenCalledOnce();
  });
});

describe("clipboard commands", () => {
  it("copies the selected text even when the selection runs backwards", async () => {
    openDocument("hello world", 0);
    useEditorStateStore.setState({ selection: rangeOf("hello world", 11, 6) });

    await copyActiveEditorSelection();

    expect(mocks.clipboard.text).toBe("world");
    expect(getDocument()).toBe("hello world");
  });

  it("leaves the clipboard alone when nothing is selected", async () => {
    mocks.clipboard.text = "previous";
    openDocument("hello", 2);

    await copyActiveEditorSelection();

    expect(mocks.clipboard.text).toBe("previous");
  });

  it("uses native copy inside the markdown preview and text fields", async () => {
    openDocument("hello", 0);
    selectOffsets(0, 5);
    const preview = document.createElement("div");
    preview.setAttribute("data-markdown-preview", "");
    preview.tabIndex = 0;
    document.body.appendChild(preview);
    preview.focus();

    await copyActiveEditorSelection();
    focusTextInput();
    await copyActiveEditorSelection();

    expect(execCommand).toHaveBeenNthCalledWith(1, "copy");
    expect(execCommand).toHaveBeenNthCalledWith(2, "copy");
    expect(mocks.clipboard.text).toBe("");
  });

  it("uses the editor model when focus is inside the editor surface", async () => {
    openDocument("hello", 0);
    selectOffsets(1, 4);
    const editor = document.createElement("div");
    editor.setAttribute("data-editor-engine", "codemirror");
    editor.innerHTML = '<div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>';
    document.body.appendChild(editor);
    editor.querySelector<HTMLElement>(".cm-content")?.focus();

    await copyActiveEditorSelection();

    expect(mocks.clipboard.text).toBe("ell");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to native copy when no editor buffer is active", async () => {
    openBuffers([], null);

    await copyActiveEditorSelection();

    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("cuts the selection into the clipboard and removes it from the document", async () => {
    openDocument("keep remove keep", 0);
    selectOffsets(5, 12);

    await cutActiveEditorSelection();

    expect(mocks.clipboard.text).toBe("remove ");
    expect(getDocument()).toBe("keep keep");
  });

  it("does not cut without a model selection", async () => {
    openDocument("keep", 0);

    await cutActiveEditorSelection();

    expect(mocks.clipboard.text).toBe("");
    expect(getDocument()).toBe("keep");
  });

  it("uses native cut in text fields", async () => {
    openDocument("keep", 0);
    focusTextInput();

    await cutActiveEditorSelection();

    expect(execCommand).toHaveBeenCalledWith("cut");
  });

  it("replaces the selection with the clipboard text", async () => {
    mocks.clipboard.text = "there";
    openDocument("hello world", 0);
    selectOffsets(6, 11);

    await pasteIntoActiveEditor();

    expect(getDocument()).toBe("hello there");
  });

  it("inserts the clipboard text at the cursor without a selection", async () => {
    mocks.clipboard.text = ", ";
    openDocument("helloworld", 5);

    await pasteIntoActiveEditor();

    expect(getDocument()).toBe("hello, world");
  });

  it("ignores an empty clipboard", async () => {
    openDocument("hello", 5);

    await pasteIntoActiveEditor();

    expect(getDocument()).toBe("hello");
  });

  it("pastes into text fields through the native insert command", async () => {
    mocks.clipboard.text = "query";
    openDocument("hello", 0);
    focusTextInput();

    await pasteIntoActiveEditor();

    expect(execCommand).toHaveBeenCalledWith("insertText", false, "query");
    expect(getDocument()).toBe("hello");
  });
});

describe("occurrence selection", () => {
  it("lets the active editor surface handle find-match selection when it can", () => {
    const adapter = createAdapter({
      addSelectionToNextFindMatch: vi.fn(),
      addSelectionToPreviousFindMatch: vi.fn(),
      selectAllFindMatches: vi.fn(),
    });
    editorAPI.setActiveEditorAdapter(adapter);
    openDocument("foo foo", 1);

    selectNextEditorOccurrence();
    selectPreviousEditorOccurrence();
    selectAllEditorOccurrences();

    expect(adapter.addSelectionToNextFindMatch).toHaveBeenCalledOnce();
    expect(adapter.addSelectionToPreviousFindMatch).toHaveBeenCalledOnce();
    expect(adapter.selectAllFindMatches).toHaveBeenCalledOnce();
    expect(selectedOffsets()).toBeNull();
    expect(useEditorStateStore.getState().multiCursorState).toBeNull();
  });

  it("selects the word under the cursor first", () => {
    openDocument("foo bar foo", 1);

    selectNextEditorOccurrence();

    expect(selectedOffsets()).toEqual({ start: 0, end: 3 });
    expect(useEditorStateStore.getState().cursorPosition.offset).toBe(3);
    expect(useEditorStateStore.getState().multiCursorState).toBeNull();
  });

  it("adds a cursor at the next occurrence of the selection", () => {
    openDocument("foo bar foo baz foo", 0);
    selectOffsets(0, 3);

    selectNextEditorOccurrence();

    expect(cursorSelections()).toEqual([
      [0, 3],
      [8, 11],
    ]);

    selectNextEditorOccurrence();

    expect(cursorSelections()).toEqual([
      [0, 3],
      [8, 11],
      [16, 19],
    ]);
  });

  it("adds a cursor at the previous occurrence, wrapping around the document", () => {
    openDocument("foo bar foo", 0);
    selectOffsets(0, 3);

    selectPreviousEditorOccurrence();

    expect(cursorSelections()).toEqual([
      [0, 3],
      [8, 11],
    ]);
  });

  it("does nothing when the selection has no other occurrence", () => {
    openDocument("unique text", 0);
    selectOffsets(0, 6);

    selectNextEditorOccurrence();

    expect(useEditorStateStore.getState().multiCursorState).toBeNull();
    expect(selectedOffsets()).toEqual({ start: 0, end: 6 });
  });

  it("selects every occurrence of the word under the cursor", () => {
    openDocument("id = id + id", 6);

    selectAllEditorOccurrences();

    expect(selectedOffsets()).toEqual({ start: 0, end: 2 });
    expect(cursorSelections()).toEqual([
      [0, 2],
      [5, 7],
      [10, 12],
    ]);
  });

  it("replaces existing cursors with the occurrences of the selection", () => {
    openDocument("a-b a-b", 0);
    selectOffsets(0, 3);
    useEditorStateStore.getState().actions.enableMultiCursor();
    useEditorStateStore
      .getState()
      .actions.addCursor(calculateCursorPositionFromContent(5, "a-b a-b"));

    selectAllEditorOccurrences();

    expect(cursorSelections()).toEqual([
      [0, 3],
      [4, 7],
    ]);
  });

  it("leaves the editor untouched when there is no word to match", () => {
    openDocument("   ", 1);

    selectAllEditorOccurrences();

    expect(selectedOffsets()).toBeNull();
    expect(useEditorStateStore.getState().multiCursorState).toBeNull();
  });
});

describe("line commands", () => {
  const content = "one\ntwo\nthree";
  const onLineTwo = "one\nt".length;

  it.each([
    ["duplicates", duplicateActiveEditorLine, "one\ntwo\ntwo\nthree"],
    ["deletes", deleteActiveEditorLine, "one\nthree"],
    ["moves up", moveActiveEditorLineUp, "two\none\nthree"],
    ["moves down", moveActiveEditorLineDown, "one\nthree\ntwo"],
    ["copies up", copyActiveEditorLineUp, "one\ntwo\ntwo\nthree"],
    ["copies down", copyActiveEditorLineDown, "one\ntwo\ntwo\nthree"],
    ["comments", toggleActiveEditorComment, "one\n// two\nthree"],
  ])("%s the line under the cursor", (_label, command, expected) => {
    openDocument(content, onLineTwo);

    command();

    expect(getDocument()).toBe(expected);
  });

  it("keeps the cursor on the copied line when copying down", () => {
    openDocument(content, onLineTwo);

    copyActiveEditorLineDown();

    expect(useEditorStateStore.getState().cursorPosition.line).toBe(2);
  });
});

describe("multi-cursor commands", () => {
  it("adds cursors above and below the primary cursor", () => {
    openDocument("abc\nabcdef\na", "abc\nabcd".length);

    insertActiveEditorCursorAbove();
    insertActiveEditorCursorBelow();

    const cursors = useEditorStateStore.getState().multiCursorState?.cursors ?? [];
    expect(cursors.map(({ position }) => [position.line, position.column])).toEqual([
      [1, 4],
      [0, 3],
      [2, 1],
    ]);
  });

  it("does not add a cursor above the first line", () => {
    openDocument("abc\ndef", 1);

    insertActiveEditorCursorAbove();

    expect(useEditorStateStore.getState().multiCursorState).toBeNull();
  });

  it("places a cursor at the end of every selected line", () => {
    const content = "ab\ncde\nf";
    openDocument(content, 0);
    selectOffsets(0, content.length);

    insertActiveEditorCursorsAtLineEnds();

    expect(cursorSelections()).toEqual([[2], [6], [8]]);
    expect(selectedOffsets()).toBeNull();
  });

  it("collapses back to the primary cursor", () => {
    openDocument("abc\ndef", 1);
    insertActiveEditorCursorBelow();

    removeActiveEditorSecondaryCursors();

    expect(cursorSelections()).toEqual([[1]]);
  });
});

describe("bracket and selection commands", () => {
  it("jumps to the matching bracket", () => {
    openDocument("call(arg)", 4);

    goToActiveEditorMatchingBracket();

    expect(useEditorStateStore.getState().cursorPosition.offset).toBe(8);
  });

  it("selects the bracketed block including the brackets", () => {
    openDocument("call(arg)", 6);

    selectToActiveEditorBracket();

    expect(selectedOffsets()).toEqual({ start: 4, end: 9 });
  });

  it("removes the bracket pair around the cursor", () => {
    openDocument("call(arg)", 4);

    removeActiveEditorBrackets();

    expect(getDocument()).toBe("callarg");
  });

  it("expands to the word and shrinks back to the cursor's word", () => {
    openDocument("value = other", 2);

    expandActiveEditorSelection();
    expect(selectedOffsets()).toEqual({ start: 0, end: 5 });

    expandActiveEditorSelection();
    expect(selectedOffsets()).toEqual({ start: 0, end: "value = other".length });

    shrinkActiveEditorSelection();
    expect(selectedOffsets()).toEqual({ start: 0, end: 5 });
  });
});

describe("editor events", () => {
  it.each([
    ["editor:trigger-suggest", triggerActiveEditorSuggest],
    ["editor:trigger-signature-help", triggerActiveEditorParameterHints],
    ["editor:rename-symbol", triggerActiveEditorRenameSymbol],
    ["editor:show-hover", showHoverForActiveEditor],
  ] as const)("broadcasts %s to the mounted editor", async (eventName, command) => {
    const listener = vi.fn();
    const stopListening = onAppEvent(eventName, listener);

    await command();

    stopListening();
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe("inline edit toolbar", () => {
  it("targets the active editor view", () => {
    openDocument("text", 0);
    useEditorStateStore.setState({ activeEditorViewKey: "split-view-2" });

    showInlineEditToolbar();

    expect(useInlineEditToolbarStore.getState()).toMatchObject({
      isVisible: true,
      targetViewKey: "split-view-2",
      requestId: 1,
    });
  });

  it("falls back to the active buffer without an editor view", () => {
    openDocument("text", 0);

    showInlineEditToolbar();

    expect(useInlineEditToolbarStore.getState().targetViewKey).toBe(BUFFER_ID);
  });

  it("opens without a target when nothing is active", () => {
    openBuffers([], null);

    showInlineEditToolbar();

    expect(useInlineEditToolbarStore.getState()).toMatchObject({
      isVisible: true,
      targetViewKey: null,
    });
  });
});

describe("format document", () => {
  it("writes the formatted content into the buffer and marks it dirty", async () => {
    openDocument("const a=1", 0);
    mocks.isFormattingAvailable.mockReturnValue(true);
    mocks.formatContent.mockResolvedValue({ success: true, formattedContent: "const a = 1;\n" });

    await formatActiveEditorDocument();

    expect(mocks.formatContent).toHaveBeenCalledWith({
      filePath: FILE_PATH,
      content: "const a=1",
      languageId: "typescript",
    });
    const buffer = useBufferStore.getState().buffers[0] as EditorContent;
    expect(buffer.content).toBe("const a = 1;\n");
    expect(buffer.isDirty).toBe(true);
    expect(mocks.toast.success).toHaveBeenCalledWith("Document formatted.");
  });

  it("refuses virtual and non-editor buffers", async () => {
    openDocument("text", 0, { isVirtual: true });

    await formatActiveEditorDocument();

    expect(mocks.toast.warning).toHaveBeenCalledWith("No editable file to format.");
    expect(mocks.formatContent).not.toHaveBeenCalled();
  });

  it("reports when no formatter handles the file type", async () => {
    openDocument("text", 0, { language: undefined });
    mocks.isFormattingAvailable.mockReturnValue(false);

    await formatActiveEditorDocument();

    expect(mocks.isFormattingAvailable).toHaveBeenCalledWith(FILE_PATH, undefined);
    expect(mocks.toast.warning).toHaveBeenCalledWith("No formatter configured for this file type.");
    expect(getDocument()).toBe("text");
  });

  it("surfaces formatter errors without touching the buffer", async () => {
    openDocument("text", 0);
    mocks.isFormattingAvailable.mockReturnValue(true);
    mocks.formatContent.mockResolvedValueOnce({ success: false, error: "prettier crashed" });
    mocks.formatContent.mockResolvedValueOnce({ success: true });

    await formatActiveEditorDocument();
    await formatActiveEditorDocument();

    expect(mocks.toast.error).toHaveBeenNthCalledWith(1, "prettier crashed");
    expect(mocks.toast.error).toHaveBeenNthCalledWith(2, "Formatting failed.");
    expect(getDocument()).toBe("text");
  });

  it("keeps the buffer clean when it is already formatted", async () => {
    openDocument("text", 0);
    mocks.isFormattingAvailable.mockReturnValue(true);
    mocks.formatContent.mockResolvedValue({ success: true, formattedContent: "text" });

    await formatActiveEditorDocument();

    expect(mocks.toast.info).toHaveBeenCalledWith("Document is already formatted.");
    expect((useBufferStore.getState().buffers[0] as EditorContent).isDirty).toBe(false);
  });
});

describe("format selection", () => {
  it("asks for a selection first", async () => {
    openDocument("text", 0);

    await formatActiveEditorSelection();

    expect(mocks.toast.warning).toHaveBeenCalledWith("Select text to format.");
    expect(mocks.formatRange).not.toHaveBeenCalled();
  });

  it("requires an editable buffer", async () => {
    openDocument("text", 0, { isVirtual: true });
    selectOffsets(0, 2);

    await formatActiveEditorSelection();

    expect(mocks.toast.warning).toHaveBeenCalledWith("No editable file to format.");
    expect(mocks.formatRange).not.toHaveBeenCalled();
  });

  it("formats the selected range and moves the cursor to its start", async () => {
    const content = "a\nlet  x=1\nb";
    openDocument(content, 0);
    selectOffsets(content.length - 1, 2);
    mocks.formatRange.mockResolvedValue({
      success: true,
      formattedContent: "a\nlet x = 1;\nb",
    });

    await formatActiveEditorSelection();

    expect(mocks.formatRange).toHaveBeenCalledWith({
      filePath: FILE_PATH,
      content,
      languageId: "typescript",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 2, character: 0 },
      },
    });
    expect(getDocument()).toBe("a\nlet x = 1;\nb");
    expect(selectedOffsets()).toBeNull();
    expect(useEditorStateStore.getState().cursorPosition).toMatchObject({
      line: 1,
      column: 0,
      offset: 2,
    });
    expect(mocks.toast.success).toHaveBeenCalledWith("Selection formatted.");
  });

  it("clamps the cursor when formatting shortens the document", async () => {
    openDocument("xxxxxxxx  ", 0);
    selectOffsets(8, 10);
    mocks.formatRange.mockResolvedValue({ success: true, formattedContent: "x" });

    await formatActiveEditorSelection();

    expect(useEditorStateStore.getState().cursorPosition.offset).toBe(1);
  });

  it("reports failures and unchanged selections", async () => {
    openDocument("text", 0);
    selectOffsets(0, 4);
    mocks.formatRange.mockResolvedValueOnce({ success: false });
    mocks.formatRange.mockResolvedValueOnce({ success: false, error: "range unsupported" });
    mocks.formatRange.mockResolvedValueOnce({ success: true, formattedContent: "text" });

    await formatActiveEditorSelection();
    await formatActiveEditorSelection();
    await formatActiveEditorSelection();

    expect(mocks.toast.error).toHaveBeenNthCalledWith(1, "Selection formatting failed.");
    expect(mocks.toast.error).toHaveBeenNthCalledWith(2, "range unsupported");
    expect(mocks.toast.info).toHaveBeenCalledWith("Selection is already formatted.");
    expect(selectedOffsets()).toEqual({ start: 0, end: 4 });
  });
});

describe("quick fix", () => {
  async function addDiagnostic(line: number, column: number, endColumn: number) {
    const { useDiagnosticsStore } = await import("@/features/diagnostics/stores/diagnostics.store");
    const diagnostic = {
      severity: "error" as const,
      filePath: FILE_PATH,
      line,
      column,
      endLine: line,
      endColumn,
      message: "Cannot find name",
    };
    useDiagnosticsStore.getState().actions.setDiagnostics(FILE_PATH, [diagnostic]);
    return diagnostic;
  }

  it("requires an editable buffer", async () => {
    openBuffers([], null);

    await runQuickFixForActiveEditor();

    expect(mocks.toast.warning).toHaveBeenCalledWith("No editable file for quick fixes.");
  });

  it("reports when the cursor line has no diagnostic", async () => {
    openDocument("ok\nbroken", 0);
    await addDiagnostic(1, 0, 6);

    await runQuickFixForActiveEditor();

    expect(mocks.toast.info).toHaveBeenCalledWith("No diagnostic at the cursor.");
    expect(mocks.getCodeActions).not.toHaveBeenCalled();
  });

  it("reports when only disabled quick fixes exist", async () => {
    openDocument("broken", 1);
    await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue([
      codeAction("Fix", { disabledReason: "Not available here" }),
    ]);

    await runQuickFixForActiveEditor();

    expect(mocks.toast.info).toHaveBeenCalledWith("No quick fixes available.");
    expect(mocks.applyCodeAction).not.toHaveBeenCalled();
  });

  it("applies the only available fix for the diagnostic under the cursor", async () => {
    openDocument("broken", 1);
    const diagnostic = await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue([codeAction("Import symbol")]);
    mocks.applyCodeAction.mockResolvedValue({ applied: true });

    await runQuickFixForActiveEditor();

    expect(mocks.getCodeActions).toHaveBeenCalledWith(
      FILE_PATH,
      expect.objectContaining(diagnostic),
    );
    expect(mocks.showChoiceDialog).not.toHaveBeenCalled();
    expect(mocks.applyCodeAction).toHaveBeenCalledWith(FILE_PATH, { title: "Import symbol" });
    expect(mocks.toast.success).toHaveBeenCalledWith("Applied: Import symbol");
  });

  it("warns when the language server cannot apply the fix", async () => {
    openDocument("broken", 1);
    await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue([codeAction("Import symbol")]);
    mocks.applyCodeAction.mockResolvedValueOnce({ applied: false, reason: "stale document" });
    mocks.applyCodeAction.mockResolvedValueOnce({ applied: false });

    await runQuickFixForActiveEditor();
    await runQuickFixForActiveEditor();

    expect(mocks.toast.warning).toHaveBeenNthCalledWith(1, "stale document");
    expect(mocks.toast.warning).toHaveBeenNthCalledWith(2, "Unable to apply action: Import symbol");
  });

  it("lets the user choose between several fixes and applies the choice", async () => {
    openDocument("broken", 1);
    await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue([
      codeAction("Add import"),
      codeAction("Disabled", { disabledReason: "nope" }),
      codeAction("Declare variable", { isPreferred: true }),
    ]);
    mocks.applyCodeAction.mockResolvedValue({ applied: true });
    mocks.showChoiceDialog.mockResolvedValue("1");

    await runQuickFixForActiveEditor();

    expect(mocks.showChoiceDialog).toHaveBeenCalledWith("Choose a quick fix:", {
      title: "Quick Fix",
      choices: [
        { value: "0", label: "Add import" },
        { value: "1", label: "Declare variable (preferred)" },
      ],
    });
    expect(mocks.applyCodeAction).toHaveBeenCalledWith(FILE_PATH, { title: "Declare variable" });
  });

  it("offers at most eight fixes", async () => {
    openDocument("broken", 1);
    await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => codeAction(`Fix ${index}`)),
    );
    mocks.showChoiceDialog.mockResolvedValue(null);

    await runQuickFixForActiveEditor();

    expect(mocks.showChoiceDialog.mock.calls[0][1].choices).toHaveLength(8);
  });

  it("applies nothing when the user dismisses the choice", async () => {
    openDocument("broken", 1);
    await addDiagnostic(0, 0, 6);
    mocks.getCodeActions.mockResolvedValue([codeAction("A"), codeAction("B")]);
    mocks.showChoiceDialog.mockResolvedValue(null);

    await runQuickFixForActiveEditor();

    expect(mocks.applyCodeAction).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});

describe("folding", () => {
  const content = "function a() {\n  if (x) {\n    y();\n  }\n}\n";

  it("collapses every foldable region", () => {
    openDocument(content, 0);

    foldAllActiveEditor();

    expect(useFoldStore.getState().actions.getCollapsedLines(FILE_PATH)).toEqual([0, 1]);
  });

  it("collapses only regions at the requested depth", () => {
    openDocument(content, 0);

    foldLevelActiveEditor(2);

    expect(useFoldStore.getState().actions.getCollapsedLines(FILE_PATH)).toEqual([1]);
  });

  it("expands every collapsed region", () => {
    openDocument(content, 0);
    foldAllActiveEditor();

    unfoldAllActiveEditor();

    expect(useFoldStore.getState().actions.getCollapsedLines(FILE_PATH)).toEqual([]);
  });

  it.each([
    ["fold all", foldAllActiveEditor],
    ["fold level", () => foldLevelActiveEditor(1)],
    ["unfold all", unfoldAllActiveEditor],
  ])("warns when %s runs without an editor", (_label, command) => {
    openBuffers([], null);

    command();

    expect(mocks.toast.warning).toHaveBeenCalledWith("No foldable editor is active.");
  });
});
