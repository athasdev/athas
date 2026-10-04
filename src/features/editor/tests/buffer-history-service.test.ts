import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { applyBufferHistory } from "../services/buffer-history-service";
import { captureBufferStoreOwner } from "../services/buffer-store-owner";
import { useBufferStore } from "../stores/buffer.store";
import {
  hasPendingBufferHistory,
  trackBufferHistoryChange,
  trackImmediateBufferHistoryChange,
} from "../stores/buffer-history-tracking";
import { useHistoryStore } from "../stores/history.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

function buffer(content = "foo"): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path: "/p/a.ts",
    name: "a.ts",
    content,
    savedContent: content,
    contentRevision: 0,
    isDirty: false,
    isVirtual: false,
    isPreview: true,
    isPinned: false,
    isActive: true,
    tokens: [],
  };
}
const owner = () => captureBufferStoreOwner("owner");
const current = () => owner().store.getState().buffers[0] as EditorContent;
function replace(nextContent: string) {
  trackImmediateBufferHistoryChange({
    bufferId: "same-id",
    currentContent: current().content,
    nextContent,
    workspaceId: "owner",
  });
  owner().store.getState().actions.updateBufferContent("same-id", nextContent);
}
function type(text: string) {
  const content = current().content;
  const nextContent = content + text;
  trackBufferHistoryChange({
    bufferId: "same-id",
    currentContent: content,
    nextContent,
    workspaceId: "owner",
    contentChanges: [
      {
        rangeOffset: content.length,
        rangeLength: 0,
        text,
        startLine: 0,
        startColumn: content.length,
        endLine: 0,
        endColumn: content.length,
      },
    ],
  });
  owner().store.getState().actions.updateBufferContent("same-id", nextContent);
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  owner().store.setState({ buffers: [buffer()], activeBufferId: "same-id" });
});
afterEach(() => workspaceRuntimeRegistry.resetForTests());

describe("editor history across native editor lifetimes", () => {
  it("undoes and redoes a replacement after the editor model has been discarded", () => {
    replace("bar");
    expect(applyBufferHistory(owner(), "same-id", "undo")?.content).toBe("foo");
    expect(current()).toMatchObject({ content: "foo", savedContent: "foo", isDirty: false });
    expect(applyBufferHistory(owner(), "same-id", "redo")?.content).toBe("bar");
    expect(current()).toMatchObject({
      content: "bar",
      savedContent: "foo",
      isDirty: true,
      isPreview: false,
    });
  });
  it("keeps the disk baseline when undoing an edit made before a save", () => {
    replace("bar");
    owner().store.getState().actions.markBufferSaved("same-id", "bar");
    applyBufferHistory(owner(), "same-id", "undo");
    expect(current()).toMatchObject({ content: "foo", savedContent: "bar", isDirty: true });
    applyBufferHistory(owner(), "same-id", "redo");
    expect(current()).toMatchObject({ content: "bar", savedContent: "bar", isDirty: false });
  });
  it("undoes grouped typing and replacement separately, then redoes both in order", () => {
    replace("bar");
    type("!");
    type("!");
    expect(hasPendingBufferHistory("same-id", "owner")).toBe(true);
    expect(applyBufferHistory(owner(), "same-id", "undo")?.content).toBe("bar");
    expect(applyBufferHistory(owner(), "same-id", "undo")?.content).toBe("foo");
    expect(applyBufferHistory(owner(), "same-id", "redo")?.content).toBe("bar");
    expect(applyBufferHistory(owner(), "same-id", "redo")?.content).toBe("bar!!");
    expect(applyBufferHistory(owner(), "same-id", "redo")).toBeNull();
  });
  it("discards Redo immediately when a new typing group begins", () => {
    replace("bar");
    applyBufferHistory(owner(), "same-id", "undo");
    expect(useHistoryStore.getStore("owner").getState().actions.canRedo("same-id")).toBe(true);
    type("!");
    expect(useHistoryStore.getStore("owner").getState().actions.canRedo("same-id")).toBe(false);
    expect(applyBufferHistory(owner(), "same-id", "redo")).toBeNull();
    expect(current().content).toBe("foo!");
    expect(applyBufferHistory(owner(), "same-id", "undo")?.content).toBe("foo");
  });
  it("restores the correct selection and stores the current selection for Redo", () => {
    const previous = {
      start: { line: 0, column: 0, offset: 0 },
      end: { line: 0, column: 3, offset: 3 },
    };
    trackImmediateBufferHistoryChange({
      bufferId: "same-id",
      currentContent: "foo",
      nextContent: "bar",
      previousSelection: previous,
      workspaceId: "owner",
    });
    owner().store.getState().actions.updateBufferContent("same-id", "bar");
    const cursorPosition = { line: 0, column: 2, offset: 2 };
    expect(applyBufferHistory(owner(), "same-id", "undo", { cursorPosition })?.selection).toEqual(
      previous,
    );
    expect(applyBufferHistory(owner(), "same-id", "redo")?.cursorPosition).toEqual(cursorPosition);
  });
  it("keeps duplicate buffer IDs in separate workspaces independent", () => {
    replace("bar");
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [buffer("other")], activeBufferId: "same-id" });
    expect(applyBufferHistory(owner(), "same-id", "undo")?.content).toBe("foo");
    expect((useBufferStore.getState().buffers[0] as EditorContent).content).toBe("other");
    expect(useHistoryStore.getState().actions.canRedo("same-id")).toBe(false);
  });
  it("rejects an evicted owner even when the same workspace and buffer IDs are recreated", () => {
    replace("bar");
    const captured = owner();
    workspaceRuntimeRegistry.removeWorkspace("owner");
    workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Reopened" });
    owner().store.setState({ buffers: [buffer("new")] });
    expect(applyBufferHistory(captured, "same-id", "undo")).toBeNull();
    expect(current().content).toBe("new");
  });
  it.each(["readOnly", "isVirtual"] as const)(
    "leaves a %s document and its history untouched",
    (flag) => {
      replace("bar");
      owner().store.setState({ buffers: [{ ...current(), [flag]: true }] });
      expect(applyBufferHistory(owner(), "same-id", "undo")).toBeNull();
      expect(current().content).toBe("bar");
      expect(useHistoryStore.getStore("owner").getState().actions.canUndo("same-id")).toBe(true);
    },
  );
  it("does not reopen a closed document to apply Undo", () => {
    replace("bar");
    owner().store.setState({ buffers: [] });
    expect(applyBufferHistory(owner(), "same-id", "undo")).toBeNull();
    expect(owner().store.getState().buffers).toEqual([]);
  });
});
