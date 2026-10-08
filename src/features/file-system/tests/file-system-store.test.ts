// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/stores/buffer-index";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { gitDiffCache } from "@/features/git/services/git-diff-cache";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { getActiveBufferId, isBufferPreview } from "@/features/panes/stores/pane-selectors";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { onAppEvent } from "@/utils/app-events";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import type { FileEntry } from "../types/app.types";
import { findFileInTree } from "../services/file-tree-utils";
import { useFileSystemStore } from "../stores/file-system.store";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const mocks = vi.hoisted(() => ({
  readWorkspaceDirectoryEntries: vi.fn(),
  mutations: {
    kind: "local" as const,
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    deletePath: vi.fn(),
    movePath: vi.fn(),
    renamePath: vi.fn(),
  },
  copyFile: vi.fn(),
  revealItemInDir: vi.fn(),
  showAlertDialog: vi.fn(),
  showPromptDialog: vi.fn(),
  readFileOpenText: vi.fn(),
  fffListFiles: vi.fn(),
  ensureWorkspaceFileSearch: vi.fn(),
}));

// Mirrors the Tauri path plugin: `extname` has no leading dot and rejects names without one.
vi.mock("@tauri-apps/api/path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/path")>()),
  basename: async (path: string) => path.slice(path.lastIndexOf("/") + 1),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  extname: async (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    const dot = name.lastIndexOf(".");
    if (dot <= 0) throw new Error("path does not have an extension");
    return name.slice(dot + 1);
  },
}));
vi.mock("@tauri-apps/plugin-fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-fs")>()),
  copyFile: mocks.copyFile,
}));
vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-opener")>()),
  revealItemInDir: mocks.revealItemInDir,
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showAlertDialog: mocks.showAlertDialog,
  showPromptDialog: mocks.showPromptDialog,
}));
vi.mock("../services/workspace-resource-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/workspace-resource-provider")>()),
  readWorkspaceDirectoryEntries: mocks.readWorkspaceDirectoryEntries,
}));
vi.mock("../services/workspace-entry-mutation-provider", () => ({
  getWorkspaceEntryMutationProvider: () => mocks.mutations,
}));
vi.mock("../services/file-open-resource", () => ({
  createFileOpenResource: (path: string) => ({
    path,
    shouldInspectBytes: false,
    provider: { kind: "local" },
  }),
  inspectFileOpenResource: vi.fn(),
  readFileOpenText: mocks.readFileOpenText,
}));
vi.mock("@/features/file-search/api/file-search-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-search/api/file-search-api")>()),
  fffListFiles: mocks.fffListFiles,
  fffTrackAccess: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/features/file-search/services/workspace-file-search", () => ({
  ensureWorkspaceFileSearch: mocks.ensureWorkspaceFileSearch,
}));

enableMapSet();

const root = "/repo/ws";

const file = (path: string): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir: false,
});

const dir = (path: string, children?: FileEntry[]): FileEntry => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  isDir: true,
  children,
});

const fs = () => useFileSystemStore.getState();
const tree = () => useFileTreeStore.getState().actions;
const buffers = () => useBufferStore.getState();
const entry = (path: string) => findFileInTree(fs().files, path) ?? undefined;

const setRoot = (path: string | undefined) =>
  useProjectStore.getState().actions.setRootFolderPath(path);

const setWorkspace = (children: FileEntry[]) => {
  setRoot(root);
  useFileSystemStore.setState({
    files: [dir(root, children)],
    filesVersion: 0,
    projectFilesCache: undefined,
  });
};

const openTextBuffer = (path: string) =>
  buffers().actions.openBuffer(path, path.slice(path.lastIndexOf("/") + 1), "content");

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  mocks.readFileOpenText.mockResolvedValue("");
  mocks.ensureWorkspaceFileSearch.mockImplementation(async (paths: string[]) => paths);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  workspaceRuntimeRegistry.resetForTests();
});

describe("toggleFolder", () => {
  it("loads children on first expand and keeps them cached after collapsing", async () => {
    setWorkspace([dir(`${root}/src`)]);
    mocks.readWorkspaceDirectoryEntries.mockResolvedValue([file(`${root}/src/index.ts`)]);

    await fs().toggleFolder(`${root}/src`);

    expect(mocks.readWorkspaceDirectoryEntries).toHaveBeenCalledWith(`${root}/src`, root);
    expect(tree().isExpanded(`${root}/src`)).toBe(true);
    expect(entry(`${root}/src`)?.children?.map((child) => child.name)).toEqual(["index.ts"]);
    const versionAfterExpand = fs().filesVersion;
    expect(versionAfterExpand).toBeGreaterThan(0);

    mocks.readWorkspaceDirectoryEntries.mockClear();
    await fs().toggleFolder(`${root}/src`);

    expect(tree().isExpanded(`${root}/src`)).toBe(false);
    expect(entry(`${root}/src`)?.children).toHaveLength(1);
    expect(mocks.readWorkspaceDirectoryEntries).not.toHaveBeenCalled();
    expect(fs().filesVersion).toBe(versionAfterExpand);
  });

  it("does not re-read a folder whose children are already loaded", async () => {
    setWorkspace([dir(`${root}/src`, [file(`${root}/src/a.ts`)])]);

    await fs().toggleFolder(`${root}/src`);

    expect(tree().isExpanded(`${root}/src`)).toBe(true);
    expect(mocks.readWorkspaceDirectoryEntries).not.toHaveBeenCalledWith(`${root}/src`, root);
  });

  it("reports a folder that cannot be read and leaves it collapsed", async () => {
    setWorkspace([dir(`${root}/gone`)]);
    mocks.readWorkspaceDirectoryEntries.mockRejectedValue(new Error("No such directory"));

    await fs().toggleFolder(`${root}/gone`);

    expect(toast.error).toHaveBeenCalledWith("Could not open folder gone", {
      description: "No such directory",
    });
    expect(tree().isExpanded(`${root}/gone`)).toBe(false);
  });

  it("ignores files and unknown paths", async () => {
    setWorkspace([file(`${root}/a.ts`)]);

    await fs().toggleFolder(`${root}/a.ts`);
    await fs().toggleFolder(`${root}/missing`);

    expect(tree().getExpandedPaths().size).toBe(0);
    expect(mocks.readWorkspaceDirectoryEntries).not.toHaveBeenCalled();
  });
});

describe("revealPathInTree", () => {
  it("loads and expands every unloaded ancestor of the target", async () => {
    setWorkspace([dir(`${root}/src`)]);
    mocks.readWorkspaceDirectoryEntries.mockImplementation(async (path: string) =>
      path === `${root}/src` ? [dir(`${root}/src/lib`)] : [file(`${root}/src/lib/a.ts`)],
    );

    await fs().revealPathInTree(`${root}/src/lib/a.ts`);

    expect(entry(`${root}/src/lib/a.ts`)).toBeDefined();
    expect([...tree().getExpandedPaths()]).toEqual(
      expect.arrayContaining([root, `${root}/src`, `${root}/src/lib`]),
    );
  });

  it("drops an older reveal when a newer one starts before it finishes", async () => {
    setWorkspace([dir(`${root}/a`), dir(`${root}/b`)]);
    let releaseFirst: (entries: FileEntry[]) => void = () => {};
    mocks.readWorkspaceDirectoryEntries.mockImplementation((path: string) =>
      path === `${root}/a`
        ? new Promise<FileEntry[]>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve([file(`${root}/b/b.ts`)]),
    );

    const first = fs().revealPathInTree(`${root}/a/a.ts`);
    await fs().revealPathInTree(`${root}/b/b.ts`);
    releaseFirst([file(`${root}/a/a.ts`)]);
    await first;

    expect(entry(`${root}/a/a.ts`)).toBeUndefined();
    expect(tree().isExpanded(`${root}/a`)).toBe(false);
    expect(tree().isExpanded(`${root}/b`)).toBe(true);
  });
});

describe("preloadSubtree", () => {
  it("loads nested folders breadth-first up to the requested depth", async () => {
    setWorkspace([dir(`${root}/a`)]);
    mocks.readWorkspaceDirectoryEntries.mockImplementation(async (path: string) => [
      dir(`${path}/next`),
    ]);

    await fs().preloadSubtree(`${root}/a`, 2, 10);

    expect(mocks.readWorkspaceDirectoryEntries.mock.calls.map(([path]) => path)).toEqual([
      `${root}/a`,
      `${root}/a/next`,
    ]);
    expect(entry(`${root}/a/next/next`)).toBeDefined();
    expect(entry(`${root}/a/next/next`)?.children).toBeUndefined();
  });

  it("stops when the tree is replaced while a batch is loading", async () => {
    setWorkspace([dir(`${root}/a`)]);
    mocks.readWorkspaceDirectoryEntries.mockImplementation(async (path: string) => {
      fs().setFiles([dir(root, [])]);
      return [dir(`${path}/next`)];
    });

    await fs().preloadSubtree(`${root}/a`, 3, 10);

    expect(mocks.readWorkspaceDirectoryEntries).toHaveBeenCalledOnce();
    expect(fs().files).toEqual([dir(root, [])]);
  });
});

describe("creating entries", () => {
  it("opens numbered untitled buffers when no folder is open", async () => {
    setRoot(undefined);
    useFileSystemStore.setState({ files: [] });

    await fs().handleCreateNewFile();
    await fs().handleCreateNewFile();

    expect(buffers().buffers.map((buffer) => buffer.path)).toEqual([
      "untitled:Untitled",
      "untitled:Untitled-2",
    ]);
  });

  it("adds an inline-editing placeholder next to the selected file", async () => {
    setWorkspace([dir(`${root}/src`, [file(`${root}/src/a.ts`)])]);
    useSidebarStore.getState().actions.updateActivePath(`${root}/src/a.ts`);

    await fs().handleCreateNewFile();

    const placeholder = entry(`${root}/src`)?.children?.find((child) => child.isNewItem);
    expect(placeholder).toMatchObject({ path: `${root}/src/`, isDir: false, isEditing: true });
  });

  it("asks for a folder before creating a new folder placeholder", async () => {
    setRoot(undefined);
    useFileSystemStore.setState({ files: [] });

    await fs().handleCreateNewFolder();

    expect(mocks.showAlertDialog).toHaveBeenCalledWith("Please open a folder first", "New Folder");
    expect(fs().files).toEqual([]);
  });

  it("creates missing intermediate folders and reuses existing ones", async () => {
    setWorkspace([dir(`${root}/src`, [])]);
    mocks.mutations.createDirectory.mockImplementation(
      async (parent: string, name: string) => `${parent}/${name}`,
    );
    mocks.mutations.createFile.mockImplementation(
      async (parent: string, name: string) => `${parent}/${name}`,
    );

    const created = await fs().handleCreateNewFileInDirectory(root, "src/utils/math.ts");

    expect(created).toBe(`${root}/src/utils/math.ts`);
    expect(mocks.mutations.createDirectory).toHaveBeenCalledExactlyOnceWith(`${root}/src`, "utils");
    expect(mocks.mutations.createFile).toHaveBeenCalledWith(`${root}/src/utils`, "math.ts");
    expect(entry(`${root}/src/utils/math.ts`)).toMatchObject({ isDir: false });
    expect(getBufferByPath(buffers().buffers, `${root}/src/utils/math.ts`)).toBeDefined();
  });

  it.each(["../escape.ts", "src/../../escape.ts", "./a.ts", "a\\b.ts"])(
    "rejects the unsafe file name %s",
    async (name) => {
      setWorkspace([]);

      await fs().handleCreateNewFileInDirectory(root, name);

      expect(mocks.showAlertDialog).toHaveBeenCalledWith(
        "Invalid file name: path traversal and special characters are not allowed",
        "New File",
      );
      expect(mocks.mutations.createFile).not.toHaveBeenCalled();
      expect(mocks.mutations.createDirectory).not.toHaveBeenCalled();
    },
  );

  it("does nothing when the name prompt is cancelled", async () => {
    setWorkspace([]);
    mocks.showPromptDialog.mockResolvedValue(null);

    await expect(fs().handleCreateNewFileInDirectory(root)).resolves.toBeUndefined();
    await expect(fs().handleCreateNewFolderInDirectory(root)).resolves.toBeUndefined();

    expect(mocks.mutations.createFile).not.toHaveBeenCalled();
    expect(mocks.mutations.createDirectory).not.toHaveBeenCalled();
  });

  it("reports a failed create instead of throwing", async () => {
    setWorkspace([]);
    mocks.mutations.createFile.mockRejectedValue(new Error("Permission denied"));

    await expect(fs().handleCreateNewFileInDirectory(root, "a.ts")).resolves.toBeUndefined();

    expect(mocks.showAlertDialog).toHaveBeenCalledWith(
      "Failed to create file: Permission denied",
      "New File",
    );
  });
});

describe("deleting, moving and renaming", () => {
  it("deletes the entry, closes its buffer and drops cached diffs", async () => {
    setWorkspace([file(`${root}/a.ts`), file(`${root}/b.ts`)]);
    openTextBuffer(`${root}/a.ts`);
    const invalidate = vi.spyOn(gitDiffCache, "invalidate");

    await fs().handleDeletePath(`${root}/a.ts`, false);

    expect(mocks.mutations.deletePath).toHaveBeenCalledWith(`${root}/a.ts`, false);
    expect(entry(`${root}/a.ts`)).toBeUndefined();
    expect(entry(`${root}/b.ts`)).toBeDefined();
    expect(getBufferByPath(buffers().buffers, `${root}/a.ts`)).toBeNull();
    expect(invalidate).toHaveBeenCalledWith(root, `${root}/a.ts`);
  });

  it("passes the directory flag from the tree when deleting a folder", async () => {
    setWorkspace([dir(`${root}/src`, [])]);

    await fs().deleteFile(`${root}/src`);

    expect(mocks.mutations.deletePath).toHaveBeenCalledWith(`${root}/src`, true);
  });

  it("keeps the tree unchanged when the delete fails", async () => {
    setWorkspace([file(`${root}/a.ts`)]);
    mocks.mutations.deletePath.mockRejectedValue(new Error("busy"));

    await expect(fs().deleteFile(`${root}/a.ts`)).rejects.toThrow("busy");

    expect(entry(`${root}/a.ts`)).toBeDefined();
  });

  it("moves a file into another folder and retargets its open buffer", async () => {
    setWorkspace([file(`${root}/a.ts`), dir(`${root}/lib`, [])]);
    openTextBuffer(`${root}/a.ts`);
    useFileSystemStore.setState({
      projectFilesCache: { path: root, files: [], timestamp: Date.now() },
    });

    await fs().handleFileMove(`${root}/a.ts`, `${root}/lib/b.ts`);

    expect(mocks.mutations.movePath).toHaveBeenCalledWith(`${root}/a.ts`, `${root}/lib/b.ts`);
    expect(entry(`${root}/a.ts`)).toBeUndefined();
    expect(entry(`${root}/lib/b.ts`)).toMatchObject({ name: "b.ts" });
    expect(getBufferByPath(buffers().buffers, `${root}/lib/b.ts`)).toMatchObject({
      name: "b.ts",
    });
    expect(fs().projectFilesCache).toBeUndefined();
  });

  it("ignores a move for a path that is not in the tree", async () => {
    setWorkspace([]);

    await fs().handleFileMove(`${root}/missing.ts`, `${root}/b.ts`);

    expect(mocks.mutations.movePath).not.toHaveBeenCalled();
  });

  it("renames the entry and its open buffer", async () => {
    setWorkspace([{ ...file(`${root}/a.ts`), isRenaming: true }]);
    openTextBuffer(`${root}/a.ts`);
    mocks.mutations.renamePath.mockResolvedValue(`${root}/b.ts`);

    await fs().handleRenamePath(`${root}/a.ts`, "b.ts");

    expect(entry(`${root}/b.ts`)).toMatchObject({ name: "b.ts", isRenaming: false });
    expect(getBufferByPath(buffers().buffers, `${root}/b.ts`)).toMatchObject({ name: "b.ts" });
  });

  it("leaves rename mode with the old name when the rename fails", async () => {
    setWorkspace([{ ...file(`${root}/a.ts`), isRenaming: true }]);
    mocks.mutations.renamePath.mockRejectedValue(new Error("exists"));

    await fs().handleRenamePath(`${root}/a.ts`, "b.ts");

    expect(entry(`${root}/a.ts`)).toMatchObject({ name: "a.ts", isRenaming: false });
  });

  it("toggles rename mode when no new name is given", async () => {
    setWorkspace([file(`${root}/a.ts`)]);

    await fs().handleRenamePath(`${root}/a.ts`);
    expect(entry(`${root}/a.ts`)?.isRenaming).toBe(true);

    await fs().handleRenamePath(`${root}/a.ts`);
    expect(entry(`${root}/a.ts`)?.isRenaming).toBe(false);
  });
});

describe("handleDuplicatePath", () => {
  it.each([
    ["index.ts", "index_copy.ts"],
    ["archive.tar.gz", "archive.tar_copy.gz"],
    ["Makefile", "Makefile_copy"],
  ])("copies local %s next to the original as %s", async (name, copyName) => {
    setWorkspace([file(`${root}/${name}`)]);

    await fs().handleDuplicatePath(`${root}/${name}`);

    expect(mocks.copyFile).toHaveBeenCalledWith(`${root}/${name}`, `${root}/${copyName}`);
    expect(entry(`${root}/${copyName}`)).toMatchObject({ name: copyName, isDir: false });
  });

  it("numbers the copy when the first copy name is taken", async () => {
    setWorkspace([file(`${root}/index.ts`), file(`${root}/index_copy.ts`)]);

    await fs().handleDuplicatePath(`${root}/index.ts`);

    expect(mocks.copyFile).toHaveBeenCalledWith(`${root}/index.ts`, `${root}/index_copy_1.ts`);
  });

  it("copies a remote file over SSH", async () => {
    const remoteRoot = "remote://conn";
    setRoot(remoteRoot);
    useFileSystemStore.setState({
      files: [dir(remoteRoot, [dir(`${remoteRoot}/src`, [file(`${remoteRoot}/src/a.ts`)])])],
    });
    const sshCopyPath = vi.spyOn(commands, "sshCopyPath").mockResolvedValue(undefined as never);

    await fs().handleDuplicatePath(`${remoteRoot}/src/a.ts`);

    expect(sshCopyPath).toHaveBeenCalledWith("conn", "/src/a.ts", "/src/a_copy.ts", false);
    expect(entry(`${remoteRoot}/src/a_copy.ts`)).toBeDefined();
  });

  it("copies a WSL file inside the distribution", async () => {
    const wslRoot = "wsl://Ubuntu/home/me";
    setRoot(wslRoot);
    useFileSystemStore.setState({
      files: [dir(wslRoot, [file(`${wslRoot}/a.ts`)])],
    });
    const wslCopyPath = vi.spyOn(commands, "wslCopyPath").mockResolvedValue(undefined as never);

    await fs().handleDuplicatePath(`${wslRoot}/a.ts`);

    expect(wslCopyPath).toHaveBeenCalledWith(
      "Ubuntu",
      "/home/me/a.ts",
      "/home/me/a_copy.ts",
      false,
    );
    expect(entry(`${wslRoot}/a_copy.ts`)).toBeDefined();
  });
});

describe("handleRevealInFolder", () => {
  it("explains that remote paths cannot be revealed", async () => {
    await fs().handleRevealInFolder("remote://conn/a.ts");

    expect(toast.info).toHaveBeenCalledWith(
      "Reveal in folder is only available for local workspaces.",
    );
    expect(mocks.revealItemInDir).not.toHaveBeenCalled();
  });

  it("reveals WSL paths through their Windows path", async () => {
    vi.spyOn(commands, "wslResolveWindowsPath").mockResolvedValue("\\\\wsl$\\Ubuntu\\a.ts");

    await fs().handleRevealInFolder("wsl://Ubuntu/a.ts");

    expect(mocks.revealItemInDir).toHaveBeenCalledWith("\\\\wsl$\\Ubuntu\\a.ts");
  });

  it("reveals local paths directly", async () => {
    await fs().handleRevealInFolder(`${root}/a.ts`);

    expect(mocks.revealItemInDir).toHaveBeenCalledWith(`${root}/a.ts`);
  });
});

describe("refreshDirectory", () => {
  it("skips collapsed folders unless forced", async () => {
    setWorkspace([dir(`${root}/src`, [file(`${root}/src/old.ts`)])]);
    mocks.readWorkspaceDirectoryEntries.mockResolvedValue([
      { ...file(`${root}/src/new.ts`), isSymlink: false },
    ]);

    await fs().refreshDirectory(`${root}/src`);
    expect(mocks.readWorkspaceDirectoryEntries).not.toHaveBeenCalled();

    await fs().refreshDirectory(`${root}/src`, { force: true });
    expect(entry(`${root}/src/new.ts`)).toBeDefined();
    expect(entry(`${root}/src/old.ts`)).toBeUndefined();
  });

  it("always refreshes the workspace root", async () => {
    setWorkspace([file(`${root}/old.ts`)]);
    mocks.readWorkspaceDirectoryEntries.mockResolvedValue([file(`${root}/new.ts`)]);

    await fs().refreshDirectory(root);

    expect(entry(`${root}/new.ts`)).toBeDefined();
    expect(entry(`${root}/old.ts`)).toBeUndefined();
  });
});

describe("workspace folders", () => {
  it("adds a second root folder and expands it", async () => {
    setWorkspace([]);
    mocks.readWorkspaceDirectoryEntries.mockResolvedValue([file("/repo/other/readme.md")]);

    await expect(fs().addFolderToWorkspace("/repo/other")).resolves.toBe(true);

    expect(fs().files.map((rootEntry) => rootEntry.path)).toEqual([root, "/repo/other"]);
    expect(useProjectStore.getState().workspaceFolders.map((folder) => folder.path)).toEqual([
      root,
      "/repo/other",
    ]);
    expect(tree().isExpanded("/repo/other")).toBe(true);
    expect(mocks.ensureWorkspaceFileSearch).toHaveBeenCalledWith([root, "/repo/other"]);
  });

  it("does not add the same folder twice", async () => {
    setWorkspace([]);

    await expect(fs().addFolderToWorkspace(root)).resolves.toBe(true);

    expect(toast.info).toHaveBeenCalledWith("Folder is already in this workspace.");
    expect(fs().files).toHaveLength(1);
  });

  it("refuses to mix remote folders into a local workspace", async () => {
    setWorkspace([]);

    await expect(fs().addFolderToWorkspace("remote://conn")).resolves.toBe(false);

    expect(toast.warning).toHaveBeenCalled();
  });

  it("reports a folder that cannot be read", async () => {
    setWorkspace([]);
    mocks.readWorkspaceDirectoryEntries.mockRejectedValue(new Error("denied"));

    await expect(fs().addFolderToWorkspace("/repo/locked")).resolves.toBe(false);

    expect(fs().isFileTreeLoading).toBe(false);
    expect(fs().files).toHaveLength(1);
  });

  it("removes a secondary folder but keeps the primary one", async () => {
    setWorkspace([]);
    mocks.readWorkspaceDirectoryEntries.mockResolvedValue([]);
    await fs().addFolderToWorkspace("/repo/other");

    await expect(fs().removeFolderFromWorkspace(root)).resolves.toBe(false);
    expect(toast.warning).toHaveBeenCalledWith("Primary workspace folder cannot be removed.");

    await expect(fs().removeFolderFromWorkspace("/repo/other")).resolves.toBe(true);
    expect(fs().files.map((rootEntry) => rootEntry.path)).toEqual([root]);
    expect(useProjectStore.getState().workspaceFolders.map((folder) => folder.path)).toEqual([
      root,
    ]);
  });
});

describe("getAllProjectFiles", () => {
  it("returns nothing without an open folder", async () => {
    setRoot(undefined);

    await expect(fs().getAllProjectFiles()).resolves.toEqual([]);
  });

  it("lists local workspaces through the native file index", async () => {
    setWorkspace([]);
    mocks.fffListFiles.mockResolvedValue([{ name: "a.ts", path: `${root}/a.ts` }]);

    await expect(fs().getAllProjectFiles()).resolves.toEqual([
      { name: "a.ts", path: `${root}/a.ts`, isDir: false },
    ]);
    expect(mocks.fffListFiles).toHaveBeenCalledWith([root]);
  });

  it("serves a fresh cache for non-native workspaces", async () => {
    const cached = [file("remote://conn/a.ts")];
    setRoot("remote://conn");
    useFileSystemStore.setState({
      projectFilesCache: { path: "remote://conn", files: cached, timestamp: Date.now() },
    });

    await expect(fs().getAllProjectFiles()).resolves.toBe(cached);
    expect(mocks.fffListFiles).not.toHaveBeenCalled();
  });
});

describe("handleFileSelect", () => {
  const openBuffer = (path: string) => getBufferByPath(buffers().buffers, path);

  it("toggles folders instead of opening them", async () => {
    setWorkspace([dir(`${root}/src`, [file(`${root}/src/a.ts`)])]);

    await fs().handleFileSelect(`${root}/src`, true);

    expect(tree().isExpanded(`${root}/src`)).toBe(true);
    expect(buffers().buffers).toHaveLength(0);
  });

  it("reads text files and opens them as editor buffers", async () => {
    setWorkspace([file(`${root}/a.ts`)]);
    mocks.readFileOpenText.mockResolvedValue("export const a = 1;");

    await fs().handleFileSelect(`${root}/a.ts`, false);

    expect(openBuffer(`${root}/a.ts`)).toMatchObject({
      type: "editor",
      name: "a.ts",
      content: "export const a = 1;",
    });
    expect(getActiveBufferId()).toBe(openBuffer(`${root}/a.ts`)?.id);
  });

  it("reuses an open buffer and promotes a preview to a definite tab", async () => {
    setWorkspace([file(`${root}/a.ts`)]);
    await fs().handleFileSelect(`${root}/a.ts`, false, undefined, undefined, undefined, true);
    expect(isBufferPreview(openBuffer(`${root}/a.ts`)?.id ?? "")).toBe(true);
    mocks.readFileOpenText.mockClear();

    await fs().handleFileOpen(`${root}/a.ts`, false);

    expect(mocks.readFileOpenText).not.toHaveBeenCalled();
    expect(buffers().buffers).toHaveLength(1);
    expect(isBufferPreview(openBuffer(`${root}/a.ts`)?.id ?? "")).toBe(false);
  });

  it.each([
    ["logo.png", "image"],
    ["guide.pdf", "pdf"],
    ["app.sqlite", "database"],
    ["tool.exe", "binary"],
  ])("opens %s as a %s buffer without reading it as text", async (name, type) => {
    setWorkspace([file(`${root}/${name}`)]);

    await fs().handleFileSelect(`${root}/${name}`, false);

    expect(openBuffer(`${root}/${name}`)).toMatchObject({ type });
    expect(mocks.readFileOpenText).not.toHaveBeenCalled();
  });

  it("opens stored diff content for virtual diff paths", async () => {
    const path = `diff://staged/${encodeURIComponent("src/a.ts")}`;
    localStorage.setItem(`diff-content-${path}`, "@@ -1 +1 @@");

    await fs().handleFileSelect(path, false);

    expect(openBuffer(path)).toMatchObject({ name: "a.ts (staged)" });
    localStorage.removeItem(`diff-content-${path}`);
  });

  it("reports a file that cannot be read without opening a tab", async () => {
    setWorkspace([file(`${root}/a.ts`)]);
    mocks.readFileOpenText.mockRejectedValue(new Error("Permission denied"));

    await fs().handleFileSelect(`${root}/a.ts`, false);

    expect(toast.error).toHaveBeenCalledWith("Could not open a.ts", {
      description: "Permission denied",
    });
    expect(buffers().buffers).toHaveLength(0);
  });

  it("only opens the latest file when an earlier read finishes last", async () => {
    setWorkspace([file(`${root}/slow.ts`), file(`${root}/fast.ts`)]);
    let releaseSlow: (content: string) => void = () => {};
    mocks.readFileOpenText.mockImplementation((resource: { path: string }) =>
      resource.path.endsWith("slow.ts")
        ? new Promise<string>((resolve) => {
            releaseSlow = resolve;
          })
        : Promise.resolve("fast"),
    );

    const slow = fs().handleFileSelect(`${root}/slow.ts`, false);
    await vi.waitFor(() => expect(mocks.readFileOpenText).toHaveBeenCalledOnce());
    await fs().handleFileSelect(`${root}/fast.ts`, false);
    releaseSlow("slow");
    await slow;

    expect(buffers().buffers.map((buffer) => buffer.path)).toEqual([`${root}/fast.ts`]);
  });

  it("asks the editor to jump to the requested line", async () => {
    vi.useFakeTimers();
    try {
      setWorkspace([file(`${root}/a.ts`)]);
      const goToLine = vi.fn();
      const stopListening = onAppEvent("editor:go-to-line", goToLine);

      await fs().handleFileSelect(`${root}/a.ts`, false, 12, 4);
      await vi.advanceTimersByTimeAsync(100);

      expect(goToLine).toHaveBeenCalledOnce();
      expect(goToLine.mock.calls[0][0]).toEqual({
        line: 12,
        column: 4,
        path: `${root}/a.ts`,
      });
      stopListening();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("resetWorkspace", () => {
  it("closes buffers and clears the workspace", async () => {
    setWorkspace([file(`${root}/a.ts`)]);
    openTextBuffer(`${root}/a.ts`);
    tree().setExpandedPaths(new Set([root]));

    await fs().resetWorkspace();

    expect(fs()).toMatchObject({ files: [], projectFilesCache: undefined });
    expect(useProjectStore.getState()).toMatchObject({
      rootFolderPath: undefined,
      workspaceFolders: [],
    });
    expect(buffers().buffers).toHaveLength(0);
    expect(tree().getExpandedPaths().size).toBe(0);
  });
});
