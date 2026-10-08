import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { useBufferStore as BufferHook } from "../stores/buffer.store";
import { savePendingPaneClose } from "@/features/panes/services/pane-content-save-service";
import { seedActiveBuffer } from "@/features/panes/tests/helpers/seed-pane-tabs";

const mocks = vi.hoisted(() => ({ write: vi.fn(), saveDialog: vi.fn() }));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({ writeText: mocks.write }),
}));
vi.mock("@/features/file-system/api/file-system-api", () => ({ writeFile: mocks.write }));
vi.mock("@/features/local-history/api/local-history-api", () => ({
  recordLocalHistoryFile: vi.fn(),
}));
vi.mock("@/utils/toast", () => ({ showToast: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mocks.saveDialog }));
vi.mock("@/features/editor/lsp/lsp-client", () => ({
  LspClient: { getInstance: () => ({ notifyDocumentSave: vi.fn() }) },
}));

function editor(id: string, dirty = true): EditorContent {
  return {
    id,
    type: "editor",
    path: `/workspace/${id}.ts`,
    name: `${id}.ts`,
    content: `${id} draft`,
    savedContent: dirty ? "" : `${id} draft`,
    isDirty: dirty,
    isVirtual: false,
    language: "typescript",
  };
}

let useBufferStore: typeof BufferHook;
let workspaceId: string;

beforeEach(async () => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
  workspaceId = "owner";
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() });
  vi.stubGlobal("window", {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
  ({ useBufferStore } = await import("../stores/buffer.store"));
  const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, formatOnSave: false, autoSave: false, lintOnSave: false },
  }));
  useBufferStore.setState({
    buffers: [editor("a"), editor("b")],
    pendingClose: { bufferId: "a", type: "single" },
  });
  seedActiveBuffer("b");
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.saveDialog.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function request() {
  return useBufferStore.getState().pendingClose!;
}

describe("saving a pending close", () => {
  it("saves the requested tab instead of the active tab", async () => {
    await expect(savePendingPaneClose(workspaceId, request())).resolves.toBe(true);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith("/workspace/a.ts", "a draft", "");
    expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(["b"]);
  });

  it("keeps the dirty tab open after a failed save", async () => {
    mocks.write.mockRejectedValueOnce(new Error("Disk changed"));
    const pending = request();
    await expect(savePendingPaneClose(workspaceId, pending)).resolves.toBe(false);
    expect(useBufferStore.getState().pendingClose).toBe(pending);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({ id: "a", isDirty: true });
  });

  it("keeps an untitled tab open when its save dialog is canceled", async () => {
    useBufferStore.setState({ buffers: [{ ...editor("a"), path: "untitled:a.ts" }] });
    await expect(savePendingPaneClose(workspaceId, request())).resolves.toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(useBufferStore.getState().buffers).toHaveLength(1);
  });

  it("keeps newer text typed during the write open", async () => {
    let finish: () => void = () => {};
    mocks.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = request();
    const save = savePendingPaneClose(workspaceId, pending);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("a", "newer draft", true);
    finish();
    await expect(save).resolves.toBe(false);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "newer draft",
      savedContent: "a draft",
      isDirty: true,
    });
    expect(useBufferStore.getState().pendingClose).toBe(pending);
  });

  it("does not act on a replacement close decision", async () => {
    let finish: () => void = () => {};
    mocks.write.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const save = savePendingPaneClose(workspaceId, request());
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.setPendingClose({ bufferId: "b", type: "single" });
    const replacement = request();
    finish();
    await expect(save).resolves.toBe(false);
    expect(useBufferStore.getState().pendingClose).toBe(replacement);
    expect(useBufferStore.getState().buffers).toHaveLength(2);
  });

  it("keeps the close decision in its owner after switching workspaces", async () => {
    const owner = useBufferStore.getStore(workspaceId);
    const pending = request();
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({
      buffers: [editor("a")],
      pendingClose: { bufferId: "a", type: "single" },
    });
    await expect(savePendingPaneClose(workspaceId, pending)).resolves.toBe(true);
    expect(owner.getState().buffers.map((buffer) => buffer.id)).toEqual(["b"]);
    expect(useBufferStore.getState().buffers).toHaveLength(1);
    expect(useBufferStore.getState().pendingClose).not.toBeNull();
  });

  it.each(["all", "others", "to-left", "to-right"] as const)(
    "prompts for each dirty tab when saving a %s close",
    async (type) => {
      useBufferStore.setState({
        buffers:
          type === "to-right"
            ? [editor("keep", false), editor("a"), editor("b")]
            : [editor("a"), editor("b"), editor("keep", false)],
        pendingClose: { bufferId: "a", type, keepBufferId: "keep", anchorBufferId: "keep" },
      });
      await expect(savePendingPaneClose(workspaceId, request())).resolves.toBe(true);
      expect(request()).toMatchObject({ bufferId: "b", type });
      expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "b")).toMatchObject({
        isDirty: true,
      });
      await expect(savePendingPaneClose(workspaceId, request())).resolves.toBe(true);
      expect(useBufferStore.getState().pendingClose).toBeNull();
      expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(
        type === "all" ? [] : ["keep"],
      );
    },
  );

  it.each(["all", "others", "to-left", "to-right"] as const)(
    "discards only the reviewed draft in a %s close",
    (type) => {
      useBufferStore.setState({
        buffers:
          type === "to-right"
            ? [editor("keep", false), editor("a"), editor("b")]
            : [editor("a"), editor("b"), editor("keep", false)],
        pendingClose: { bufferId: "a", type, keepBufferId: "keep", anchorBufferId: "keep" },
      });
      useBufferStore.getState().actions.confirmCloseWithoutSaving();
      expect(request()).toMatchObject({ bufferId: "b", type });
      expect(useBufferStore.getState().buffers.find((buffer) => buffer.id === "b")).toMatchObject({
        isDirty: true,
      });
      useBufferStore.getState().actions.confirmCloseWithoutSaving();
      expect(useBufferStore.getState().pendingClose).toBeNull();
      expect(useBufferStore.getState().buffers.map((buffer) => buffer.id)).toEqual(
        type === "all" ? [] : ["keep"],
      );
    },
  );

  it("does not recreate a workspace for a stale close callback", async () => {
    const pending = request();
    workspaceRuntimeRegistry.removeWorkspace(workspaceId);
    await expect(savePendingPaneClose(workspaceId, pending)).resolves.toBe(false);
    expect(workspaceRuntimeRegistry.hasWorkspace(workspaceId)).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
