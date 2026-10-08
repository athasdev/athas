import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import { restoreLocalHistorySnapshot } from "../services/restore-local-history";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { useHistoryStore } from "@/features/editor/stores/history.store";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  snapshot: vi.fn(),
  record: vi.fn(),
  confirm: vi.fn(),
  git: vi.fn(),
}));
vi.mock("@/features/file-system/services/workspace-resource-provider", () => ({
  getWorkspaceResourceProvider: () => ({
    kind: "local",
    readText: mocks.read,
    writeText: mocks.write,
  }),
}));
vi.mock("../api/local-history-api", () => ({
  readLocalHistoryEntry: mocks.snapshot,
  recordLocalHistoryFile: mocks.record,
}));
vi.mock("@/ui/dialog", () => ({ showConfirmDialog: mocks.confirm }));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: mocks.git }));

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function editor(content = "disk", savedContent = "disk", id = "file"): EditorContent {
  return {
    id,
    type: "editor",
    path: "/workspace/file.ts",
    name: "file.ts",
    content,
    savedContent,
    isDirty: content !== savedContent,
    isVirtual: false,
    language: "typescript",
  };
}
const options = { path: "/workspace/file.ts", entryId: "snapshot", workspaceId: "owner" };

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  workspaceRuntimeRegistry.activateWorkspace({ id: "owner", name: "Owner" });
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
  useBufferStore.setState({ buffers: [], pendingClose: null });
  useHistoryStore.getState().actions.clearAllHistories();
  mocks.read.mockReset().mockResolvedValue("disk");
  mocks.snapshot.mockReset().mockResolvedValue("snapshot text");
  mocks.record.mockReset().mockResolvedValue(null);
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.git.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("local history restoration", () => {
  it("writes a closed file with the expected disk content", async () => {
    await expect(restoreLocalHistorySnapshot(options)).resolves.toBe(true);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(options.path, "restore");
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith(options.path, "snapshot text", "disk");
    expect(useBufferStore.getState().buffers).toHaveLength(0);
  });

  it.each(["disk", "unsaved draft"])("restores an open %s and retains Undo", async (content) => {
    useBufferStore.setState({ buffers: [editor(content)] });
    await expect(restoreLocalHistorySnapshot(options)).resolves.toBe(true);
    expect(mocks.confirm).toHaveBeenCalledTimes(content === "disk" ? 0 : 1);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "snapshot text",
      savedContent: "snapshot text",
      isDirty: false,
    });
    expect(
      useHistoryStore.getState().actions.undo("file", { content: "snapshot text", timestamp: 0 }),
    ).toMatchObject({ content });
  });

  it("does not read or write after unsaved-change confirmation is canceled", async () => {
    useBufferStore.setState({ buffers: [editor("draft")] });
    mocks.confirm.mockResolvedValue(false);
    await expect(restoreLocalHistorySnapshot(options)).resolves.toBe(false);
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses read-only files before reading the snapshot", async () => {
    useBufferStore.setState({ buffers: [{ ...editor(), readOnly: true }] });
    await expect(restoreLocalHistorySnapshot(options)).rejects.toThrow("read-only");
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses disk changes that have not reached the open editor", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    mocks.read.mockResolvedValue("external change");
    await expect(restoreLocalHistorySnapshot(options)).rejects.toThrow("changed on disk");
    expect(mocks.record).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("refuses a newer draft while reading the snapshot", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const snapshot = deferred<string>();
    mocks.snapshot.mockReturnValue(snapshot.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.snapshot).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("file", "new draft", true);
    snapshot.resolve("snapshot text");
    await expect(restore).rejects.toThrow("changed while preparing");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("detects changed-and-reverted drafts while recording history", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const record = deferred<null>();
    mocks.record.mockReturnValue(record.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("file", "new draft", true);
    useBufferStore.getState().actions.updateBufferContent("file", "disk", true);
    record.resolve(null);
    await expect(restore).rejects.toThrow("changed while preparing");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the write, watcher and editor in their original workspace", async () => {
    const owner = useBufferStore.getStore("owner");
    owner.setState({ buffers: [editor()] });
    const record = deferred<null>();
    mocks.record.mockReturnValue(record.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.activateWorkspace({ id: "other", name: "Other" });
    useBufferStore.setState({ buffers: [editor("other draft")] });
    record.resolve(null);
    await expect(restore).resolves.toBe(true);
    expect(owner.getState().buffers[0]).toMatchObject({ content: "snapshot text", isDirty: false });
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "other draft",
      savedContent: "disk",
      isDirty: true,
    });
    expect(useFileWatcherStore.getStore("owner").getState().pendingSaves.has(options.path)).toBe(
      true,
    );
    expect(useFileWatcherStore.getStore("other").getState().pendingSaves.has(options.path)).toBe(
      false,
    );
  });

  it("preserves text typed while the native write is pending", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const write = deferred<void>();
    mocks.write.mockReturnValue(write.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("file", "new draft", true);
    write.resolve();
    await expect(restore).resolves.toBe(true);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "new draft",
      savedContent: "snapshot text",
      isDirty: true,
    });
  });

  it("does not acknowledge an old restore after a newer save", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const write = deferred<void>();
    mocks.write.mockReturnValue(write.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    useBufferStore.getState().actions.updateBufferContent("file", "new saved text", false);
    write.resolve();
    await expect(restore).resolves.toBe(true);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "new saved text",
      savedContent: "new saved text",
      isDirty: false,
    });
  });

  it("refuses a tab opened before the write starts", async () => {
    const record = deferred<null>();
    mocks.record.mockReturnValue(record.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    useBufferStore.setState({ buffers: [editor("late draft")] });
    record.resolve(null);
    await expect(restore).rejects.toThrow("changed while preparing");
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("keeps the draft and updates its baseline after cancellation during a committed write", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const write = deferred<void>();
    const controller = new AbortController();
    mocks.write.mockReturnValue(write.promise);
    const restore = restoreLocalHistorySnapshot({ ...options, signal: controller.signal });
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    controller.abort();
    write.resolve();
    await expect(restore).resolves.toBe(true);
    expect(useBufferStore.getState().buffers[0]).toMatchObject({
      content: "disk",
      savedContent: "snapshot text",
      isDirty: true,
    });
  });

  it("does not resurrect a tab closed during the write", async () => {
    useBufferStore.setState({ buffers: [editor()] });
    const write = deferred<void>();
    mocks.write.mockReturnValue(write.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    useBufferStore.setState({ buffers: [] });
    write.resolve();
    await expect(restore).resolves.toBe(true);
    expect(useBufferStore.getState().buffers).toHaveLength(0);
  });

  it("stops before writing for a removed and reopened workspace", async () => {
    const record = deferred<null>();
    mocks.record.mockReturnValue(record.promise);
    const restore = restoreLocalHistorySnapshot(options);
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    workspaceRuntimeRegistry.removeWorkspace("owner");
    useBufferStore.getStore("owner").setState({ buffers: [editor()] });
    record.resolve(null);
    await expect(restore).resolves.toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("stops before writing when the history view closes", async () => {
    const record = deferred<null>();
    mocks.record.mockReturnValue(record.promise);
    const controller = new AbortController();
    const restore = restoreLocalHistorySnapshot({ ...options, signal: controller.signal });
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
    controller.abort();
    record.resolve(null);
    await expect(restore).resolves.toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("shares a pending restore and permits retry after a failed write", async () => {
    const write = deferred<void>();
    mocks.write.mockReturnValueOnce(write.promise).mockRejectedValueOnce(new Error("Disk changed"));
    const restore = restoreLocalHistorySnapshot(options);
    expect(restoreLocalHistorySnapshot(options)).toBe(restore);
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    write.resolve();
    await expect(restore).resolves.toBe(true);
    await expect(restoreLocalHistorySnapshot(options)).rejects.toThrow("Disk changed");
    expect(useFileWatcherStore.getState().pendingSaves.has(options.path)).toBe(false);
    await expect(restoreLocalHistorySnapshot(options)).resolves.toBe(true);
    expect(mocks.write).toHaveBeenCalledTimes(3);
  });
});
