import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { WindowCloseSession } from "../services/window-close-session";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/features/editor/services/editor-save-service", () => ({ saveEditorBufferById: save }));
function draft(content = "draft"): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path: "/workspace/file.ts",
    name: "file.ts",
    content,
    savedContent: "disk",
    isDirty: true,
    isVirtual: false,
    language: "typescript",
  };
}
function owner(id: string) {
  const store = useBufferStore.getStore(id);
  store.setState({ buffers: [draft(id)] });
  return store;
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  save.mockReset().mockResolvedValue(false);
});

describe("window close ownership", () => {
  it("finds inactive workspace drafts after the active workspace is clean", () => {
    owner("inactive");
    workspaceRuntimeRegistry.activateWorkspace({ id: "active", name: "Active" });
    useBufferStore.setState({ buffers: [] });
    expect(new WindowCloseSession().findBlockingDraft()?.owner.workspaceId).toBe("inactive");
  });
  it("handles the active workspace first and does not merge identical buffer IDs", () => {
    owner("a");
    owner("b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "b", name: "B" });
    const session = new WindowCloseSession();
    const first = session.findBlockingDraft()!;
    expect(first.owner.workspaceId).toBe("b");
    expect(session.discard(first)).toBe(true);
    expect(session.findBlockingDraft()?.owner.workspaceId).toBe("a");
  });
  it("asks again when an approved draft changes, even if its text is reverted", () => {
    const store = owner("a");
    const session = new WindowCloseSession();
    const first = session.findBlockingDraft()!;
    session.discard(first);
    expect(session.findBlockingDraft()).toBeNull();
    store.getState().actions.updateBufferContent("same-id", "new draft", true);
    store.getState().actions.updateBufferContent("same-id", "a", true);
    expect(session.findBlockingDraft()).not.toBeNull();
    expect(session.discard(first)).toBe(false);
  });
  it("does not retain discard approval across workspace removal and reopening", () => {
    owner("a");
    const session = new WindowCloseSession();
    session.discard(session.findBlockingDraft()!);
    workspaceRuntimeRegistry.removeWorkspace("a");
    owner("a");
    expect(session.findBlockingDraft()).not.toBeNull();
  });
  it("saves the original owner after another workspace becomes active", async () => {
    const store = owner("a");
    const session = new WindowCloseSession();
    const request = session.findBlockingDraft()!;
    owner("b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "b", name: "B" });
    save.mockImplementation(async () => {
      store.getState().actions.markBufferSaved("same-id", "a");
      return true;
    });
    await expect(session.save(request)).resolves.toBe(true);
    expect(save).toHaveBeenCalledExactlyOnceWith(request.owner, "same-id");
    expect(session.findBlockingDraft()?.owner.workspaceId).toBe("b");
  });
  it("does not continue closing after cancellation during a save", async () => {
    const store = owner("a");
    const session = new WindowCloseSession();
    const request = session.findBlockingDraft()!;
    const response = deferred<boolean>();
    save.mockReturnValue(response.promise);
    const result = session.save(request);
    session.reset();
    store.getState().actions.markBufferSaved("same-id", "a");
    response.resolve(true);
    await expect(result).resolves.toBe(false);
  });
  it("keeps newer drafts blocking after an older write completes", async () => {
    const store = owner("a");
    const session = new WindowCloseSession();
    const request = session.findBlockingDraft()!;
    const response = deferred<boolean>();
    save.mockReturnValue(response.promise);
    const result = session.save(request);
    store.getState().actions.updateBufferContent("same-id", "new draft", true);
    store.getState().actions.markBufferSaved("same-id", "a");
    response.resolve(true);
    await expect(result).resolves.toBe(false);
    expect(session.findBlockingDraft()?.buffer).toMatchObject({ content: "new draft" });
  });
  it("does not save a retired owner or a renamed buffer", async () => {
    const store = owner("a");
    const session = new WindowCloseSession();
    const request = session.findBlockingDraft()!;
    store.setState({ buffers: [{ ...draft(), path: "/renamed.ts" }] });
    await expect(session.save(request)).resolves.toBe(false);
    workspaceRuntimeRegistry.removeWorkspace("a");
    await expect(session.save(request)).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });
  it("clears discard approvals when closing is canceled", () => {
    owner("a");
    const session = new WindowCloseSession();
    session.discard(session.findBlockingDraft()!);
    session.reset();
    expect(session.findBlockingDraft()).not.toBeNull();
  });
});
