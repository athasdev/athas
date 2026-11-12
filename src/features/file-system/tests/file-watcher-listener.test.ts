// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { FileEntry } from "../types/app.types";
import {
  cleanupFileWatcherListener,
  handleFileChange,
  handleWorkspaceFileChanges,
  initializeFileWatcherListener,
} from "../services/file-watcher-listener";

const mocks = vi.hoisted(() => ({
  buffers: [] as Array<Record<string, unknown>>,
  diskContent: "",
  reloadBufferFromDisk: vi.fn(),
  markBufferDirty: vi.fn(),
  refreshDirectory: vi.fn(),
  showToast: vi.fn(),
  emitGitChanged: vi.fn(),
  pendingSaves: new Set<string>(),
  refreshedWorkspaces: [] as string[],
  workspaceRoots: [] as Array<{ workspaceId: string; rootFolderPath: string }>,
  loadedFiles: [] as FileEntry[],
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")),
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getStore: () => ({
      getState: () => ({
        buffers: mocks.buffers,
        actions: {
          reloadBufferFromDisk: mocks.reloadBufferFromDisk,
          markBufferDirty: mocks.markBufferDirty,
        },
      }),
    }),
  },
}));
vi.mock("@/features/git/events/git-events", () => ({ emitGitChanged: mocks.emitGitChanged }));
vi.mock("@/utils/toast", () => ({ showToast: mocks.showToast }));
vi.mock("@/features/workspace/services/workspace-runtime-registry", () => ({
  workspaceRuntimeRegistry: {
    getActiveWorkspaceId: () => "ws",
    hasWorkspace: () => true,
    getExistingStoreEntries: (key: string) =>
      key === "file-system"
        ? [{ workspaceId: "ws", store: { getState: () => ({ files: mocks.loadedFiles }) } }]
        : mocks.workspaceRoots.map(({ workspaceId, rootFolderPath }) => ({
            workspaceId,
            store: { getState: () => ({ rootFolderPath, workspaceFolders: [] }) },
          })),
  },
}));
vi.mock("../api/file-operations", () => ({
  readFileContent: async () => mocks.diskContent,
}));
vi.mock("../stores/file-system.store", () => ({
  useFileSystemStore: {
    getStore: (workspaceId: string) => ({
      getState: () => ({
        refreshDirectory: (path: string) => {
          mocks.refreshedWorkspaces.push(workspaceId);
          return mocks.refreshDirectory(path);
        },
      }),
    }),
  },
}));
vi.mock("../stores/file-watcher.store", () => ({
  useFileWatcherStore: {
    getStore: () => ({ getState: () => ({ pendingSaves: mocks.pendingSaves }) }),
  },
}));

function editor(content: string, isDirty: boolean) {
  return {
    id: "buffer-1",
    path: "/repo/a.ts",
    name: "a.ts",
    type: "editor",
    isVirtual: false,
    content,
    isDirty,
  };
}

describe("file watcher listener", () => {
  beforeEach(() => {
    mocks.buffers = [];
    mocks.diskContent = "";
    mocks.pendingSaves.clear();
    mocks.refreshedWorkspaces = [];
    mocks.workspaceRoots = [];
    mocks.loadedFiles = [];
    for (const mock of [
      mocks.reloadBufferFromDisk,
      mocks.markBufferDirty,
      mocks.refreshDirectory,
      mocks.showToast,
      mocks.emitGitChanged,
    ]) {
      mock.mockReset();
    }
  });

  it("reloads a saved editor when its file changes", async () => {
    mocks.buffers = [editor("old", false)];

    // The payload the file watcher and agent writes both send.
    await handleFileChange({ path: "/repo/a.ts", event_type: "reloaded" });

    expect(mocks.reloadBufferFromDisk).toHaveBeenCalledWith("buffer-1");
    expect(mocks.showToast).not.toHaveBeenCalled();
    expect(mocks.emitGitChanged).toHaveBeenCalledOnce();
  });

  it("keeps unsaved edits when the disk differs and offers a reload", async () => {
    mocks.buffers = [editor("user edit", true)];
    mocks.diskContent = "agent edit";

    await handleFileChange({ path: "/repo/a.ts", event_type: "reloaded" });

    expect(mocks.reloadBufferFromDisk).not.toHaveBeenCalled();
    expect(mocks.markBufferDirty).not.toHaveBeenCalled();
    const toast = mocks.showToast.mock.calls[0]?.[0];
    expect(toast).toMatchObject({
      key: "file-changed-on-disk:/repo/a.ts",
      type: "warning",
      message: "a.ts changed on disk",
      action: { label: "Reload" },
    });

    mocks.reloadBufferFromDisk.mockResolvedValue(undefined);
    toast.action.onClick();
    expect(mocks.reloadBufferFromDisk).toHaveBeenCalledWith("buffer-1");
  });

  it("marks unsaved edits saved when the disk now holds them", async () => {
    mocks.buffers = [editor("same", true)];
    mocks.diskContent = "same";

    await handleFileChange({ path: "/repo/a.ts", event_type: "reloaded" });

    expect(mocks.markBufferDirty).toHaveBeenCalledWith("buffer-1", false);
    expect(mocks.reloadBufferFromDisk).not.toHaveBeenCalled();
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it("refreshes the folder of a new file", async () => {
    vi.useFakeTimers();
    try {
      await handleFileChange({ path: "/repo/new.ts", event_type: "opened" });
      await vi.advanceTimersByTimeAsync(300);
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo");
    expect(mocks.reloadBufferFromDisk).not.toHaveBeenCalled();
  });

  it("ignores changes from the editor's own saves", async () => {
    mocks.buffers = [editor("old", false)];
    mocks.pendingSaves.add("/repo/a.ts");

    await handleFileChange({ path: "/repo/a.ts", event_type: "reloaded" });

    expect(mocks.reloadBufferFromDisk).not.toHaveBeenCalled();
    expect(mocks.emitGitChanged).not.toHaveBeenCalled();
  });

  it("refreshes Git status after an agent writes a file that is not open", async () => {
    await handleFileChange({ path: "/repo/a.ts", event_type: "reloaded", agent_write_id: 7 });

    expect(mocks.reloadBufferFromDisk).not.toHaveBeenCalled();
    expect(mocks.emitGitChanged).toHaveBeenCalledWith({
      filePath: "/repo/a.ts",
      scopes: ["working-tree"],
      source: "agent-write",
    });
  });

  it("refreshes Git status when an agent creates or deletes a file", async () => {
    vi.useFakeTimers();
    try {
      await handleFileChange({ path: "/repo/new.ts", event_type: "opened", agent_write_id: 8 });
      await handleFileChange({ path: "/repo/old.ts", event_type: "deleted" });
      await vi.advanceTimersByTimeAsync(300);
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.emitGitChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "/repo/new.ts", source: "agent-write" }),
    );
    expect(mocks.emitGitChanged).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "/repo/old.ts", scopes: ["working-tree"] }),
    );
  });

  describe("watcher batches", () => {
    async function deliver(batch: Parameters<typeof handleWorkspaceFileChanges>[0]) {
      vi.useFakeTimers();
      try {
        await handleWorkspaceFileChanges(batch);
        await vi.advanceTimersByTimeAsync(300);
      } finally {
        vi.useRealTimers();
      }
    }

    it("refreshes each changed folder once and reloads open editors", async () => {
      mocks.buffers = [editor("old", false)];

      await deliver({
        root: "/repo",
        changes: [
          { path: "/repo/new.ts", kind: "created", is_dir: false },
          { path: "/repo/other.ts", kind: "removed", is_dir: false },
          { path: "/repo/a.ts", kind: "modified", is_dir: false },
        ],
        git_changed: false,
        rescan: false,
      });

      expect(mocks.refreshDirectory).toHaveBeenCalledTimes(1);
      expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo");
      expect(mocks.reloadBufferFromDisk).toHaveBeenCalledWith("buffer-1");
    });

    it("refreshes Git status once for changes to files that are not open", async () => {
      await deliver({
        root: "/repo",
        changes: [
          { path: "/repo/a.ts", kind: "modified", is_dir: false },
          { path: "/repo/b.ts", kind: "modified", is_dir: false },
          { path: "/repo/c.ts", kind: "created", is_dir: false },
        ],
        git_changed: false,
        rescan: false,
      });

      expect(mocks.emitGitChanged).toHaveBeenCalledOnce();
      expect(mocks.emitGitChanged).toHaveBeenCalledWith({
        repoPath: "/repo",
        scopes: ["working-tree"],
        source: "external-file-change",
      });
    });

    it("leaves Git status to the save when a batch only echoes our own saves", async () => {
      mocks.pendingSaves.add("/repo/a.ts");

      await deliver({
        root: "/repo",
        changes: [{ path: "/repo/a.ts", kind: "modified", is_dir: false }],
        git_changed: false,
        rescan: false,
      });

      expect(mocks.emitGitChanged).not.toHaveBeenCalled();
    });

    it("applies a batch to the workspace that owns its root", async () => {
      mocks.workspaceRoots = [
        { workspaceId: "first", rootFolderPath: "/first" },
        { workspaceId: "second", rootFolderPath: "/second" },
      ];

      await deliver({
        root: "/second",
        changes: [{ path: "/second/new.ts", kind: "created", is_dir: false }],
        git_changed: false,
        rescan: false,
      });

      expect(mocks.refreshedWorkspaces).toEqual(["second"]);
    });

    it("refreshes the Git view when repository state changed", async () => {
      await deliver({ root: "/repo", changes: [], git_changed: true, rescan: false });

      expect(mocks.emitGitChanged).toHaveBeenCalledWith(
        expect.objectContaining({ repoPath: "/repo", scopes: expect.arrayContaining(["refs"]) }),
      );
    });

    it("re-lists the loaded folders under a changed ignore file", async () => {
      const folder = (path: string, children?: FileEntry[]): FileEntry => ({
        name: path.slice(path.lastIndexOf("/") + 1),
        path,
        isDir: true,
        children,
      });
      mocks.loadedFiles = [
        folder("/repo", [
          folder("/repo/web", [folder("/repo/web/src", []), folder("/repo/web/dist")]),
          folder("/repo/docs", []),
        ]),
      ];

      await initializeFileWatcherListener();
      try {
        await deliver({
          root: "/repo",
          changes: [{ path: "/repo/web/.gitignore", kind: "modified", is_dir: false }],
          git_changed: false,
          rescan: false,
        });
      } finally {
        await cleanupFileWatcherListener();
      }

      expect(mocks.refreshDirectory).toHaveBeenCalledTimes(2);
      expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo/web");
      expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo/web/src");
    });

    it("re-reads the whole root after a rescan", async () => {
      await deliver({ root: "/repo", changes: [], git_changed: false, rescan: true });

      expect(mocks.refreshDirectory).toHaveBeenCalledWith("/repo");
      expect(mocks.emitGitChanged).toHaveBeenCalled();
    });
  });
});
