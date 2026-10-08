import {
  undoActiveEditor,
  redoActiveEditor,
} from "@/features/keymaps/commands/editor-command-actions";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { isDirtyContent, type ImageContent } from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { savePendingPaneClose } from "@/features/panes/services/pane-content-save-service";
import { WindowCloseSession } from "@/features/window/services/window-close-session";
import {
  getImageBufferSession,
  saveImageBufferById,
} from "../image/editor/services/image-buffer-session";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";
const mocks = vi.hoisted(() => ({ save: vi.fn(), dataURL: vi.fn(), toast: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("../image/editor/utils/image-file-utils", () => ({ saveImageToFile: mocks.save }));
vi.mock("../image/editor/utils/canvas-utils", () => ({ blobToDataURL: mocks.dataURL }));
vi.mock("@/features/layout/contexts/toast-context", () => ({ showToast: mocks.toast }));
function image(id = "image"): ImageContent {
  return {
    id,
    type: "image",
    path: `/${id}.png`,
    name: `${id}.png`,
  };
}
function owner(workspaceId = "owner", images = [image()]) {
  const store = useBufferStore.getStore(workspaceId);
  store.setState({ buffers: images, pendingClose: null });
  seedActiveBuffer(images[0]?.id, workspaceId);
  return { workspaceId, store };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
async function edit(owned: ReturnType<typeof owner>, id = "image", source = "edited") {
  const session = getImageBufferSession(owned, id)!;
  session.setSource("original", true);
  await session.runOperation(
    async () => ({ blob: new Blob([source]), dimensions: { width: 1, height: 1 }, size: 1 }),
    "Failed",
  );
  return session;
}
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  vi.clearAllMocks();
  mocks.save.mockResolvedValue(true);
  mocks.dataURL.mockImplementation((blob: Blob) => blob.text());
});
describe("workspace-owned image drafts", () => {
  it("retains edits and history when a viewer reacquires its session", async () => {
    const owned = owner();
    const first = await edit(owned);
    const second = getImageBufferSession(owned, "image")!;
    expect(second).toBe(first);
    second.setSource("disk-reloaded", true);
    expect(second.getSnapshot().history[second.getSnapshot().index]).toBe("edited");
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(true);
    second.undo();
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(false);
    second.redo();
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(true);
  });
  it("uses normal Save and Save As for the active image", async () => {
    const owned = owner();
    const session = await edit(owned);
    await expect(useEditorAppStore.getState().actions.handleSave()).resolves.toBe(true);
    expect(session.getSnapshot().history[session.getSnapshot().index]).toBe("edited");
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(false);
    session.undo();
    await expect(useEditorAppStore.getState().actions.handleSaveAs()).resolves.toBe(true);
    expect(mocks.save).toHaveBeenCalledTimes(2);
  });
  it("protects an image with the normal tab close prompt and saves before closing", async () => {
    const owned = owner();
    await edit(owned);
    owned.store.getState().actions.closeBuffer("image");
    const request = owned.store.getState().pendingClose!;
    expect(request).toMatchObject({ bufferId: "image", type: "single" });
    await expect(savePendingPaneClose(owned.workspaceId, request)).resolves.toBe(true);
    expect(owned.store.getState().buffers).toHaveLength(0);
  });
  it("keeps tab closing pending when export is cancelled or a newer edit exists", async () => {
    const owned = owner();
    const session = await edit(owned);
    owned.store.getState().actions.closeBuffer("image");
    const request = owned.store.getState().pendingClose!;
    mocks.save.mockResolvedValueOnce(false);
    await expect(savePendingPaneClose(owned.workspaceId, request)).resolves.toBe(false);
    expect(owned.store.getState().pendingClose).toBe(request);
    const pending = deferred<boolean>();
    mocks.save.mockReturnValueOnce(pending.promise);
    const saving = savePendingPaneClose(owned.workspaceId, request);
    await Promise.resolve();
    session.undo();
    pending.resolve(true);
    await expect(saving).resolves.toBe(false);
    expect(owned.store.getState().pendingClose).toBe(request);
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(true);
  });
  it("prompts independently for each dirty image in Close All", async () => {
    const owned = owner("owner", [image("one"), image("two")]);
    await edit(owned, "one");
    await edit(owned, "two");
    owned.store.getState().actions.handleCloseSavedTabs();
    expect(owned.store.getState().buffers).toHaveLength(2);
    owned.store.getState().actions.handleCloseAllTabs();
    expect(owned.store.getState().pendingClose?.bufferId).toBe("one");
    owned.store.getState().actions.confirmCloseWithoutSaving();
    expect(owned.store.getState().buffers.map((buffer) => buffer.id)).toEqual(["two"]);
    expect(owned.store.getState().pendingClose?.bufferId).toBe("two");
  });
  it("finds and saves images in inactive workspaces without switching the active workspace", async () => {
    const inactive = owner("inactive");
    await edit(inactive);
    owner("owner", []);
    const closing = new WindowCloseSession();
    const request = closing.findBlockingDraft()!;
    expect(request.owner.workspaceId).toBe("inactive");
    await expect(closing.save(request)).resolves.toBe(true);
    expect(closing.findBlockingDraft()).toBeNull();
    expect(workspaceRuntimeRegistry.getActiveWorkspaceId()).toBe("owner");
  });
  it("revalidates image discard approvals after undo/redo ABA", async () => {
    const owned = owner();
    const session = await edit(owned);
    const closing = new WindowCloseSession();
    const request = closing.findBlockingDraft()!;
    expect(closing.discard(request)).toBe(true);
    expect(closing.findBlockingDraft()).toBeNull();
    session.undo();
    session.redo();
    expect(closing.discard(request)).toBe(false);
    expect(closing.findBlockingDraft()).not.toBeNull();
  });
  it("serializes Save All image dialogs and counts only completed exports", async () => {
    const owned = owner("owner", [image("one"), image("two")]);
    await edit(owned, "one");
    await edit(owned, "two");
    const first = deferred<boolean>();
    mocks.save.mockReturnValueOnce(first.promise).mockResolvedValueOnce(false);
    const saving = useEditorAppStore.getState().actions.handleSaveAll();
    await Promise.resolve();
    expect(mocks.save).toHaveBeenCalledOnce();
    first.resolve(true);
    await expect(saving).resolves.toBe(1);
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(owned.store.getState().buffers.map(isDirtyContent)).toEqual([false, true]);
  });
  it("does not apply an old result to a closed and reopened image ID", async () => {
    const owned = owner();
    const session = await edit(owned);
    const pending = deferred<boolean>();
    mocks.save.mockReturnValueOnce(pending.promise);
    const saving = saveImageBufferById(owned, "image");
    await Promise.resolve();
    const guard = mocks.save.mock.calls[0][2].isCurrent;
    owned.store.setState({ buffers: [] });
    owned.store.setState({ buffers: [image()] });
    const next = getImageBufferSession(owned, "image")!;
    next.setSource("new disk", true);
    expect(guard()).toBe(false);
    pending.resolve(true);
    await expect(saving).resolves.toBe(false);
    expect(next).not.toBe(session);
    expect(next.getSnapshot().savedSrc).toBe("new disk");
  });
  it("invalidates a pending transform when its buffer closes", async () => {
    const owned = owner();
    const session = getImageBufferSession(owned, "image")!;
    session.setSource("original", true);
    const pending = deferred<{
      blob: Blob;
      size: number;
      dimensions: { width: number; height: number };
    }>();
    const editing = session.runOperation(() => pending.promise, "Failed");
    await Promise.resolve();
    expect(isDirtyContent(owned.store.getState().buffers[0])).toBe(true);
    owned.store.getState().actions.closeBuffer("image");
    expect(owned.store.getState().pendingClose).not.toBeNull();
    owned.store.getState().actions.confirmCloseWithoutSaving();
    pending.resolve({ blob: new Blob(["late"]), size: 4, dimensions: { width: 1, height: 1 } });
    await editing;
    expect(owned.store.getState().buffers).toHaveLength(0);
    expect(session.isLive()).toBe(false);
  });
});

it("routes the existing Undo and Redo commands to the active image", async () => {
  const owned = owner();
  const session = await edit(owned);
  undoActiveEditor();
  expect(session.getSnapshot().history[session.getSnapshot().index]).toBe("original");
  redoActiveEditor();
  expect(session.getSnapshot().history[session.getSnapshot().index]).toBe("edited");
});
