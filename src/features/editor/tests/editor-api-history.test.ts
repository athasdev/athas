// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { editorAPI } from "../services/editor-api";
import { calculateCursorPositionFromContent } from "../services/position";
import { useBufferStore } from "../stores/buffer.store";
import { useEditorDecorationsStore } from "../stores/decorations.store";
import { useHistoryStore } from "../stores/history.store";
import { useEditorStateStore } from "../stores/state.store";

const BUFFER_ID = "editor-api-history";

function editor(content: string, extra: Partial<EditorContent> = {}): EditorContent {
  return {
    id: BUFFER_ID,
    type: "editor",
    path: "/ws/history.ts",
    name: "history.ts",
    content,
    savedContent: content,
    isDirty: false,
    isVirtual: false,
    language: "typescript",
    ...extra,
  };
}

function open(content: string, extra: Partial<EditorContent> = {}) {
  useBufferStore.setState({ buffers: [editor(content, extra)] });
  seedActiveBuffer(BUFFER_ID);
}

const document = () => (useBufferStore.getState().buffers[0] as EditorContent | undefined)?.content;
const position = (offset: number, content: string) =>
  calculateCursorPositionFromContent(offset, content);

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  editorAPI.setActiveEditorAdapter(null);
  useEditorStateStore.setState({
    cursorPosition: { line: 0, column: 0, offset: 0 },
    selection: undefined,
    multiCursorState: null,
    onChange: (next: string) =>
      useBufferStore.getState().actions.updateBufferContent(BUFFER_ID, next),
  });
  useEditorDecorationsStore.getState().actions.clearDecorations();
});

afterEach(() => {
  useHistoryStore.getState().actions.clearAllHistories();
  workspaceRuntimeRegistry.resetForTests();
  editorAPI.setActiveEditorAdapter(null);
});

describe("model undo and redo", () => {
  it("restores content, cursor and selection, then redoes the change", () => {
    open("alpha beta");
    const before = "alpha";
    useHistoryStore.getState().actions.pushHistory(BUFFER_ID, {
      content: before,
      cursorPosition: position(2, before),
      selection: { start: position(0, before), end: position(5, before) },
      timestamp: 1,
    });
    useEditorStateStore.setState({ cursorPosition: position(10, "alpha beta") });
    const changes: string[] = [];
    const stop = editorAPI.on("contentChange", ({ content }) => changes.push(content));

    expect(editorAPI.canUndo()).toBe(true);
    expect(editorAPI.canRedo()).toBe(false);
    editorAPI.undo();

    expect(document()).toBe("alpha");
    expect(editorAPI.getSelection()).toMatchObject({ start: { offset: 0 }, end: { offset: 5 } });
    expect(editorAPI.canRedo()).toBe(true);

    editorAPI.redo();
    stop();

    expect(document()).toBe("alpha beta");
    expect(editorAPI.getCursorPosition().offset).toBe(10);
    expect(editorAPI.getSelection()).toBeNull();
    expect(changes).toEqual(["alpha", "alpha beta"]);
  });

  it("clears the selection when the restored entry had none", () => {
    open("abc!");
    useHistoryStore.getState().actions.pushHistory(BUFFER_ID, {
      content: "abc",
      cursorPosition: position(3, "abc"),
      timestamp: 1,
    });
    editorAPI.setSelection({ start: position(0, "abc!"), end: position(4, "abc!") });

    editorAPI.undo();

    expect(document()).toBe("abc");
    expect(editorAPI.getSelection()).toBeNull();
  });

  it("does nothing without history, an active buffer, or an editable buffer", () => {
    open("same");
    editorAPI.undo();
    editorAPI.redo();
    expect(document()).toBe("same");

    open("readonly", { readOnly: true });
    expect(editorAPI.canUndo()).toBe(false);
    expect(editorAPI.canRedo()).toBe(false);

    open("scratch", { isVirtual: true });
    expect(editorAPI.canUndo()).toBe(false);

    useBufferStore.setState({ buffers: [] });
    seedActiveBuffer(null);
    editorAPI.undo();
    editorAPI.redo();
    expect(editorAPI.canUndo()).toBe(false);
    expect(editorAPI.canRedo()).toBe(false);
  });

  it("hands undo and redo to the active editor adapter", () => {
    open("adapter owned");
    const adapter = {
      ownerId: "cm",
      insertText: vi.fn(),
      deleteRange: vi.fn(),
      replaceRange: vi.fn(),
      selectAll: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    };
    editorAPI.setActiveEditorAdapter(adapter);

    editorAPI.undo();
    editorAPI.redo();

    expect(adapter.undo).toHaveBeenCalledTimes(1);
    expect(adapter.redo).toHaveBeenCalledTimes(1);
    expect(document()).toBe("adapter owned");
  });
});

describe("content and decorations", () => {
  it("replaces the active document and marks it dirty", () => {
    open("old");
    const changes = vi.fn();
    const stop = editorAPI.on("contentChange", changes);

    editorAPI.setContent("new");
    stop();
    editorAPI.setContent("newer");

    expect(useBufferStore.getState().buffers[0]).toMatchObject({ content: "newer", isDirty: true });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith({ content: "new", changes: [] });
  });

  it("adds, updates, removes and clears decorations with change events", () => {
    open("x");
    const events: string[] = [];
    const stop = editorAPI.on("decorationChange", (event) => events.push(event.type));
    const range = { start: position(0, "x"), end: position(1, "x") };

    const id = editorAPI.addDecoration({ type: "inline", range, className: "hit" });
    editorAPI.addDecoration({ type: "inline", range, className: "other" });
    editorAPI.updateDecoration(id, { className: "hit-strong" });
    expect(useEditorDecorationsStore.getState().decorations.get(id)).toMatchObject({
      className: "hit-strong",
    });

    editorAPI.removeDecoration(id);
    expect(useEditorDecorationsStore.getState().decorations.has(id)).toBe(false);
    editorAPI.clearDecorations();
    stop();

    expect(useEditorDecorationsStore.getState().decorations.size).toBe(0);
    expect(events).toEqual(["add", "add", "update", "remove", "clear"]);
  });

  it("keeps a viewport reference for scrolling", () => {
    const viewport = window.document.createElement("div");
    editorAPI.setViewportRef(viewport);
    expect(editorAPI.getViewportRef()).toBe(viewport);
    editorAPI.setViewportRef(null);
    expect(editorAPI.getViewportRef()).toBeNull();
  });
});

describe("smart selection", () => {
  it("shrinks back through the ranges it expanded", () => {
    const content = "call(alpha, beta)";
    open(content);
    useEditorStateStore.setState({ cursorPosition: position(7, content) });

    editorAPI.expandSelection();
    const first = editorAPI.getSelection();
    editorAPI.expandSelection();
    const second = editorAPI.getSelection();
    expect(second!.end.offset - second!.start.offset).toBeGreaterThan(
      first!.end.offset - first!.start.offset,
    );

    editorAPI.shrinkSelection();
    expect(editorAPI.getSelection()).toMatchObject({
      start: { offset: first!.start.offset },
      end: { offset: first!.end.offset },
    });
  });

  it("shrinks a selection it did not expand by resolving a smaller range", () => {
    const content = "call(alpha, beta)";
    open(content);
    editorAPI.setSelection({ start: position(0, content), end: position(content.length, content) });
    useEditorStateStore.setState({ cursorPosition: position(7, content) });

    editorAPI.shrinkSelection();

    const selection = editorAPI.getSelection();
    expect(selection).not.toBeNull();
    expect(selection!.end.offset - selection!.start.offset).toBeLessThan(content.length);
  });

  it("does not shrink a bare cursor", () => {
    open("abc");
    editorAPI.setSelection(undefined);
    editorAPI.shrinkSelection();
    expect(editorAPI.getSelection()).toBeNull();
  });
});
