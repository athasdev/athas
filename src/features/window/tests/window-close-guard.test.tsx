// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { WindowCloseGuard } from "../components/window-close-guard";
import { REQUEST_WINDOW_CLOSE_EVENT } from "../utils/request-window-close";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  nativeListen: vi.fn(),
  webviewListen: vi.fn(),
  unlistenNative: vi.fn(),
  unlistenWebview: vi.fn(),
  save: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    close: mocks.close,
    onCloseRequested: mocks.nativeListen,
  }),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main", listen: mocks.webviewListen }),
}));
vi.mock("@/features/editor/services/editor-save-service", () => ({
  saveEditorBufferById: mocks.save,
}));
vi.mock("@/features/ai/detached/agent-window.store", () => ({ agentsAreDetached: () => false }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, info: vi.fn() } }));
vi.mock("../components/unsaved-changes-dialog", () => ({
  default: ({
    fileName,
    onSave,
    onDiscard,
    onCancel,
  }: {
    fileName: string;
    onSave: () => Promise<unknown>;
    onDiscard: () => void;
    onCancel: () => void;
  }) => (
    <div role="alertdialog">
      {fileName}
      <button onClick={() => void onSave()}>Save</button>
      <button onClick={onDiscard}>Discard</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

function draft(id: string, dirty = true): EditorContent {
  return {
    id: "same-id",
    type: "editor",
    path: `/${id}/file.ts`,
    name: `${id}.ts`,
    content: `${id} draft`,
    savedContent: dirty ? "disk" : `${id} draft`,
    isDirty: dirty,
    isVirtual: false,
    isPinned: false,
    isPreview: false,
    isActive: false,
    language: "typescript",
    tokens: [],
  };
}
function setupWorkspace(id: string, dirty = true) {
  const store = useBufferStore.getStore(id);
  store.setState({ buffers: [draft(id, dirty)] });
  const persist = vi.fn();
  useFileSystemStore.getStore(id).setState({ persistActiveProjectSession: persist });
  return { store, persist };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
let root: Root;
let container: HTMLDivElement;
let nativeClose: (event: { preventDefault: () => void }) => void;
beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.close.mockResolvedValue(undefined);
  mocks.nativeListen.mockImplementation((listener) => {
    nativeClose = listener;
    return Promise.resolve(mocks.unlistenNative);
  });
  mocks.webviewListen.mockResolvedValue(mocks.unlistenWebview);
  mocks.save.mockImplementation(async (owner, id) => {
    const buffer = owner.store
      .getState()
      .buffers.find((candidate: EditorContent) => candidate.id === id);
    owner.store.getState().actions.markBufferSaved(id, buffer.content);
    return true;
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<WindowCloseGuard />));
}
async function requestClose() {
  const preventDefault = vi.fn();
  await act(async () => nativeClose({ preventDefault }));
  return preventDefault;
}
async function click(name: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name,
  )!;
  await act(async () => button.click());
}

describe("window close guard", () => {
  it("saves an inactive workspace before closing and persists all workspace sessions", async () => {
    const inactive = setupWorkspace("inactive");
    const active = setupWorkspace("active", false);
    workspaceRuntimeRegistry.activateWorkspace({ id: "active", name: "Active" });
    await render();
    expect(await requestClose()).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("inactive.ts (inactive)");
    await click("Save");
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "inactive" }),
      "same-id",
    );
    expect(inactive.store.getState().buffers[0]).toMatchObject({ isDirty: false });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(inactive.persist).toHaveBeenCalledOnce();
    expect(active.persist).toHaveBeenCalledOnce();
    expect(inactive.persist).toHaveBeenCalledWith({ immediate: true });
  });

  it("requires separate discard decisions for identical IDs in different workspaces", async () => {
    setupWorkspace("a");
    setupWorkspace("b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    await render();
    await requestClose();
    expect(container.textContent).toContain("a.ts");
    await click("Discard");
    expect(container.textContent).toContain("b.ts");
    expect(mocks.close).not.toHaveBeenCalled();
    await click("Discard");
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("does not close after Cancel while a save is pending", async () => {
    setupWorkspace("a");
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    const response = deferred<boolean>();
    mocks.save.mockReturnValue(response.promise);
    await render();
    await requestClose();
    await click("Save");
    await click("Cancel");
    await act(async () => response.resolve(true));
    expect(mocks.close).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it("asks again when an already discarded draft changes before final close", async () => {
    const a = setupWorkspace("a");
    setupWorkspace("b");
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    await render();
    await requestClose();
    await click("Discard");
    await act(async () =>
      a.store.getState().actions.updateBufferContent("same-id", "new a draft", true),
    );
    await click("Discard");
    expect(container.textContent).toContain("a.ts");
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("revalidates drafts that appear while the native close call is pending", async () => {
    const a = setupWorkspace("a", false);
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    const close = deferred<void>();
    mocks.close.mockReturnValue(close.promise);
    await render();
    await act(async () => window.dispatchEvent(new Event(REQUEST_WINDOW_CLOSE_EVENT)));
    expect(mocks.close).toHaveBeenCalledOnce();
    await act(async () =>
      a.store.getState().actions.updateBufferContent("same-id", "new draft", true),
    );
    expect(await requestClose()).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("a.ts");
    await act(async () => close.resolve());
  });

  it("cleans successful listeners when another registration fails", async () => {
    mocks.webviewListen.mockRejectedValueOnce(new Error("Native event unavailable"));
    await render();
    expect(mocks.unlistenNative).toHaveBeenCalledOnce();
    expect(mocks.unlistenWebview).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not protect unsaved changes"),
    );
  });

  it("prevents native closing when the session cannot be persisted", async () => {
    const a = setupWorkspace("a", false);
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    a.persist.mockImplementationOnce(() => {
      throw new Error("Storage full");
    });
    await render();
    expect(await requestClose()).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not save the window session"),
    );
    expect(mocks.close).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new Event(REQUEST_WINDOW_CLOSE_EVENT)));
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("keeps the window open and permits a fresh attempt after close rejects", async () => {
    setupWorkspace("a", false);
    workspaceRuntimeRegistry.activateWorkspace({ id: "a", name: "A" });
    mocks.close.mockRejectedValueOnce(new Error("Close unavailable"));
    await render();
    await act(async () => window.dispatchEvent(new Event(REQUEST_WINDOW_CLOSE_EVENT)));
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not close this window"),
    );
    await act(async () => window.dispatchEvent(new Event(REQUEST_WINDOW_CLOSE_EVENT)));
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });
});
