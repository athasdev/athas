// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/stores/buffer-index";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { getActiveBufferId, selectPaneBufferFlags } from "@/features/panes/stores/pane-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { workspaceSessionRepository } from "@/features/workspace/persistence/services/workspace-session-repository";
import { createProjectTabId } from "@/features/workspace/services/project-tab-path";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useSessionStore } from "@/features/workspace/stores/session.store";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import type { FileEntry } from "../types/app.types";
import { useRecentFoldersStore } from "../stores/recent-folders.store";
import { useFileSystemStore } from "../stores/file-system.store";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue(null),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const mocks = vi.hoisted(() => ({
  directories: new Map<string, Array<{ name: string; path: string; is_dir: boolean }>>(),
  unreadable: new Set<string>(),
  reads: [] as string[],
  openFolder: vi.fn<() => Promise<string | null>>(),
  ensureRemoteConnectionConnected: vi.fn(),
  createAppWindow: vi.fn(),
  readFileOpenText: vi.fn(),
  inspectFileOpenResource: vi.fn(),
  shouldInspectBytes: false,
  showPromptDialog: vi.fn(),
}));

vi.mock("../api/file-system-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/file-system-api")>()),
  openFolder: mocks.openFolder,
  readDirectory: async (path: string) => {
    mocks.reads.push(path);
    if (mocks.unreadable.has(path)) throw new Error(`EACCES: ${path}`);
    return mocks.directories.get(path) ?? [];
  },
  getSymlinkInfo: async (path: string) => ({
    is_symlink: false,
    is_dir: mocks.directories.has(path),
  }),
}));
vi.mock("@tauri-apps/api/path", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/api/path")>()),
  dirname: async (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  extname: async (path: string) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (name.lastIndexOf(".") <= 0) throw new Error("path does not have an extension");
    return name.slice(name.lastIndexOf(".") + 1);
  },
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}));
vi.mock("@/ui/dialog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui/dialog")>()),
  showAlertDialog: vi.fn(),
  showPromptDialog: mocks.showPromptDialog,
}));
vi.mock("@/features/git/api/git-status-api", () => ({
  getGitStatus: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/features/remote/services/remote-connection-client", () => ({
  ensureRemoteConnectionConnected: mocks.ensureRemoteConnectionConnected,
}));
vi.mock("@/features/window/services/create-app-window", () => ({
  createAppWindow: mocks.createAppWindow,
}));
vi.mock("@/features/file-search/services/workspace-file-search", () => ({
  ensureWorkspaceFileSearch: vi.fn().mockResolvedValue([]),
}));
vi.mock("../services/file-open-resource", () => ({
  createFileOpenResource: (path: string) => ({
    path,
    shouldInspectBytes: mocks.shouldInspectBytes,
    provider: { kind: "local" },
  }),
  inspectFileOpenResource: mocks.inspectFileOpenResource,
  readFileOpenText: mocks.readFileOpenText,
}));

enableMapSet();

const project = () => useProjectStore.getState();
const tabs = () => useWorkspaceTabsStore.getState();
const activeWorkspaceId = () => workspaceRuntimeRegistry.getActiveWorkspaceId();
const fs = () => useFileSystemStore.getState();
const fsFor = (workspaceId: string) => useFileSystemStore.getStore(workspaceId).getState();
const buffersFor = (workspaceId: string) => useBufferStore.getStore(workspaceId).getState().buffers;

function setDirectory(path: string, entries: Array<[name: string, isDir: boolean]>) {
  mocks.directories.set(
    path,
    entries.map(([name, isDir]) => ({ name, path: `${path}/${name}`, is_dir: isDir })),
  );
}

async function settle() {
  for (let index = 0; index < 5; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  workspaceRuntimeRegistry.resetForTests();
  useWorkspaceTabsStore.setState({ projectTabs: [] });
  useRecentFoldersStore.setState({ recentFolders: [] });
  useSessionStore.setState({ sessions: {} } as never);
  mocks.directories.clear();
  mocks.unreadable.clear();
  mocks.reads = [];
  mocks.openFolder.mockReset();
  mocks.createAppWindow.mockReset().mockResolvedValue(undefined);
  mocks.ensureRemoteConnectionConnected.mockReset();
  mocks.readFileOpenText.mockReset().mockImplementation(async (resource: { path: string }) => {
    return `contents of ${resource.path}`;
  });
  mocks.inspectFileOpenResource.mockReset();
  mocks.shouldInspectBytes = false;
  mocks.showPromptDialog.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(toast, "error").mockImplementation(() => "");
  vi.spyOn(toast, "warning").mockImplementation(() => "");
  vi.spyOn(toast, "success").mockImplementation(() => "");
  vi.spyOn(toast, "info").mockImplementation(() => "");
  setDirectory("/work/app", [
    ["src", true],
    ["README.md", false],
    [".git", true],
  ]);
  setDirectory("/work/lib", [["index.ts", false]]);
});

afterEach(async () => {
  await settle();
  vi.restoreAllMocks();
});

describe("opening a local folder", () => {
  it("activates a workspace with the folder tree, a tab and a recent entry", async () => {
    const opened = await fs().handleOpenFolderByPath("/work/app/");

    const workspaceId = createProjectTabId("/work/app");
    expect(opened).toBe(true);
    expect(activeWorkspaceId()).toBe(workspaceId);
    expect(workspaceRuntimeRegistry.isWorkspaceReady(workspaceId)).toBe(true);
    expect(project().rootFolderPath).toBe("/work/app");
    expect(project().projectName).toBe("app");
    expect(tabs().projectTabs.map((tab) => [tab.id, tab.path, tab.isActive])).toEqual([
      [workspaceId, "/work/app", true],
    ]);
    expect(useRecentFoldersStore.getState().recentFolders[0]?.path).toBe("/work/app");

    const [rootEntry] = fs().files;
    expect(rootEntry).toMatchObject({ name: "app", path: "/work/app", isDir: true });
    expect(rootEntry.children?.map((child) => child.name)).toEqual([".git", "src", "README.md"]);
    expect(fs().isFileTreeLoading).toBe(false);
  });

  it("reports an unreadable folder and leaves no tab behind", async () => {
    mocks.unreadable.add("/work/app");

    const opened = await fs().handleOpenFolderByPath("/work/app");

    expect(opened).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Failed to open folder: /work/app");
    expect(tabs().projectTabs).toEqual([]);
    expect(workspaceRuntimeRegistry.hasWorkspace(createProjectTabId("/work/app"))).toBe(false);
  });

  it("returns to the previous workspace when opening another folder fails", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    mocks.unreadable.add("/work/lib");

    const opened = await fs().handleOpenFolderByPath("/work/lib");

    expect(opened).toBe(false);
    expect(activeWorkspaceId()).toBe(createProjectTabId("/work/app"));
    expect(tabs().projectTabs.map((tab) => tab.path)).toEqual(["/work/app"]);
    expect(project().rootFolderPath).toBe("/work/app");
  });

  it("does nothing when the folder picker is cancelled", async () => {
    mocks.openFolder.mockResolvedValue(null);

    expect(await fs().handleOpenFolder()).toBe(false);
    expect(tabs().projectTabs).toEqual([]);
  });

  it("opens a picked folder in the current window by default", async () => {
    mocks.openFolder.mockResolvedValue("/work/lib/");

    expect(await fs().handleOpenFolder()).toBe(true);

    expect(project().rootFolderPath).toBe("/work/lib");
    expect(mocks.createAppWindow).not.toHaveBeenCalled();
    expect(useFileTreeStore.getState().actions.isExpanded("/work/lib")).toBe(true);
  });

  it("opens a picked folder in a new window when configured and a workspace is open", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, openFoldersInNewWindow: true },
    }));
    mocks.openFolder.mockResolvedValue("/work/lib");

    try {
      expect(await fs().handleOpenFolder()).toBe(true);
    } finally {
      useSettingsStore.setState((state) => ({
        settings: { ...state.settings, openFoldersInNewWindow: false },
      }));
    }

    expect(mocks.createAppWindow).toHaveBeenCalledWith({ path: "/work/lib", isDirectory: true });
    expect(tabs().projectTabs.map((tab) => tab.path)).toEqual(["/work/app"]);
  });

  it("opens the folder itself when adding a folder without an open workspace", async () => {
    expect(await fs().addFolderToWorkspace("/work/lib")).toBe(true);

    expect(project().rootFolderPath).toBe("/work/lib");
  });
});

describe("workspace sessions", () => {
  it("persists open tabs and restores them when the folder is reopened", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    const workspaceId = activeWorkspaceId()!;
    await fs().handleFileSelect("/work/app/README.md", false);
    await fs().handleFileSelect("/work/app/src/main.ts", false);
    const readme = getBufferByPath(buffersFor(workspaceId), "/work/app/README.md")!;
    useBufferStore.getStore(workspaceId).getState().actions.setActiveBuffer(readme.id);

    fs().persistActiveProjectSession({ immediate: true });

    const { session } = workspaceSessionRepository.load("/work/app");
    expect(session?.buffers.map((buffer) => buffer.path)).toEqual([
      "/work/app/README.md",
      "/work/app/src/main.ts",
    ]);
    expect(session?.activeBufferPath).toBe("/work/app/README.md");

    workspaceRuntimeRegistry.resetForTests();
    useWorkspaceTabsStore.setState({ projectTabs: [] });
    await fs().handleOpenFolderByPath("/work/app");
    const reopenedId = activeWorkspaceId()!;

    await vi.waitFor(() =>
      expect(buffersFor(reopenedId).map((buffer) => buffer.path)).toEqual([
        "/work/app/README.md",
        "/work/app/src/main.ts",
      ]),
    );
    expect(getActiveBufferId(reopenedId)).toBe(
      getBufferByPath(buffersFor(reopenedId), "/work/app/README.md")?.id,
    );
  });

  it("restores additional workspace folders and warns about missing ones", async () => {
    workspaceSessionRepository.save({
      projectPath: "/work/app",
      buffers: [],
      activeBufferPath: null,
      workspaceFolders: [
        { path: "/work/app", name: "app", isPrimary: true },
        { path: "/work/lib", name: "lib" },
        { path: "/work/gone", name: "gone" },
      ],
    });
    mocks.unreadable.add("/work/gone");

    await fs().handleOpenFolderByPath("/work/app");

    expect(fs().files.map((file) => file.path)).toEqual(["/work/app", "/work/lib"]);
    expect(project().workspaceFolders.map((folder) => folder.path)).toEqual([
      "/work/app",
      "/work/lib",
    ]);
    expect(toast.warning).toHaveBeenCalledWith('Could not restore workspace folder "gone".');
  });

  it("skips the requested buffer path while restoring a session", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    const workspaceId = activeWorkspaceId()!;
    workspaceSessionRepository.save({
      projectPath: "/work/app",
      buffers: [
        { type: "editor", path: "/work/app/a.ts", name: "a.ts", isPinned: true },
        { type: "editor", path: "/work/app/b.ts", name: "b.ts", isPinned: false },
      ],
      activeBufferPath: "/work/app/a.ts",
    });

    await fs().restoreSession("/work/app", "/work/app/b.ts");

    const restored = buffersFor(workspaceId);
    const { pinnedBufferIds } = selectPaneBufferFlags(
      usePaneStore.getStore(workspaceId).getState(),
    );
    expect(restored.map((buffer) => [buffer.path, pinnedBufferIds.has(buffer.id)])).toEqual([
      ["/work/app/a.ts", true],
    ]);
  });
});

describe("remote and WSL workspaces", () => {
  it("opens a remote project over SSH", async () => {
    mocks.ensureRemoteConnectionConnected.mockResolvedValue({ id: "conn-1", name: "Build Box" });
    vi.spyOn(commands, "sshReadDirectory").mockResolvedValue([
      { name: "etc", path: "/etc", is_dir: true, size: 0 },
      { name: "notes.txt", path: "/notes.txt", is_dir: false, size: 3 },
    ] as never);

    const opened = await fs().handleOpenRemoteProject("conn-1", "Build Box");

    expect(opened).toBe(true);
    expect(commands.sshReadDirectory).toHaveBeenCalledWith("conn-1", "/");
    expect(project().projectName).toBe("Build Box");
    expect(project().rootFolderPath?.startsWith("remote://conn-1")).toBe(true);
    expect(fs().files[0].children?.map((child) => child.name)).toEqual(["etc", "notes.txt"]);
  });

  it("reports a remote connection failure without keeping a tab", async () => {
    mocks.ensureRemoteConnectionConnected.mockRejectedValue(new Error("Host unreachable"));

    const opened = await fs().handleOpenRemoteProject("conn-1", "Build Box");

    expect(opened).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Host unreachable");
    expect(tabs().projectTabs).toEqual([]);
  });

  it("opens WSL paths through the WSL reader and records them as recents", async () => {
    vi.spyOn(commands, "wslReadDirectory").mockResolvedValue([
      { name: "project", path: "/home/me/project", is_dir: true },
    ] as never);

    const opened = await fs().handleOpenFolderByPath("wsl://Ubuntu/home/me");

    expect(opened).toBe(true);
    expect(commands.wslReadDirectory).toHaveBeenCalledWith("Ubuntu", "/home/me");
    expect(project().rootFolderPath).toBe("wsl://Ubuntu/home/me");
    expect(useRecentFoldersStore.getState().recentFolders[0]?.path).toBe("wsl://Ubuntu/home/me");
  });

  it("reports WSL read failures", async () => {
    vi.spyOn(commands, "wslReadDirectory").mockRejectedValue("distro stopped");

    const opened = await fs().handleOpenWslProject("Ubuntu", "");

    expect(opened).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Failed to open WSL project.");
  });
});

describe("switching and closing projects", () => {
  it("switches between ready workspaces without reloading them", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    const appId = activeWorkspaceId()!;
    await fs().handleOpenFolderByPath("/work/lib");
    const libId = activeWorkspaceId()!;
    mocks.unreadable.add("/work/app");

    expect(await fs().switchToProject(appId)).toBe(true);

    expect(activeWorkspaceId()).toBe(appId);
    expect(project().rootFolderPath).toBe("/work/app");
    expect(fsFor(appId).files[0].path).toBe("/work/app");
    expect(fsFor(libId).files[0].path).toBe("/work/lib");
  });

  it("initializes a tab that has not been loaded yet when switching to it", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    useWorkspaceTabsStore.getState().actions.addProjectTab("/work/lib", "lib");
    const libId = createProjectTabId("/work/lib");
    useWorkspaceTabsStore.getState().actions.setActiveProjectTab(createProjectTabId("/work/app"));

    expect(await fs().switchToProject(libId)).toBe(true);

    expect(activeWorkspaceId()).toBe(libId);
    expect(fsFor(libId).files[0].children?.map((child) => child.name)).toEqual(["index.ts"]);
    expect(fsFor(libId).isSwitchingProject).toBe(false);
  });

  it("stays on the current project when the target cannot be loaded", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    const appId = activeWorkspaceId()!;
    useWorkspaceTabsStore.getState().actions.addProjectTab("/work/missing", "missing");
    mocks.unreadable.add("/work/missing");

    const switched = await fs().switchToProject(createProjectTabId("/work/missing"));

    expect(switched).toBe(false);
    expect(toast.error).toHaveBeenCalledWith("Failed to switch project.");
    expect(activeWorkspaceId()).toBe(appId);
    expect(fsFor(appId).isSwitchingProject).toBe(false);
  });

  it("closing the active project switches to the remaining one", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    const appId = activeWorkspaceId()!;
    await fs().handleOpenFolderByPath("/work/lib");
    const libId = activeWorkspaceId()!;

    expect(await fs().closeProject(libId)).toBe(true);

    expect(tabs().projectTabs.map((tab) => tab.id)).toEqual([appId]);
    expect(activeWorkspaceId()).toBe(appId);
    expect(workspaceRuntimeRegistry.hasWorkspace(libId)).toBe(false);
  });

  it("closing the last project returns to the welcome state", async () => {
    await fs().handleOpenFolderByPath("/work/app");

    expect(await fs().closeFolder()).toBe(true);

    expect(tabs().projectTabs).toEqual([]);
    expect(project().rootFolderPath).toBeUndefined();
    expect(project().projectName).toBe("Files");
  });

  it("ignores unknown projects and resets state when no tab is active", async () => {
    expect(await fs().closeProject("missing")).toBe(false);
    expect(await fs().switchToProject("missing")).toBe(false);

    useProjectStore.getState().actions.setRootFolderPath("/work/app");
    useFileSystemStore.setState({ files: [{ name: "app", path: "/work/app", isDir: true }] });

    expect(await fs().closeFolder()).toBe(true);
    expect(fs().files).toEqual([]);
    expect(project().rootFolderPath).toBeUndefined();
  });
});

describe("opening files by type", () => {
  beforeEach(async () => {
    await fs().handleOpenFolderByPath("/work/app");
  });

  const openedBuffer = (path: string) => getBufferByPath(buffersFor(activeWorkspaceId()!), path);

  it("opens media, documents and databases in dedicated viewers without reading text", async () => {
    await fs().handleFileSelect("/work/app/logo.png", false);
    await fs().handleFileSelect("/work/app/spec.pdf", false);
    await fs().handleFileSelect("/work/app/data.sqlite", false);
    await fs().handleFileSelect("/work/app/archive.zip", false);

    expect(openedBuffer("/work/app/logo.png")?.type).toBe("image");
    expect(openedBuffer("/work/app/spec.pdf")?.type).toBe("pdf");
    expect(openedBuffer("/work/app/data.sqlite")?.type).toBe("database");
    expect(openedBuffer("/work/app/archive.zip")?.type).toBe("binary");
    expect(mocks.readFileOpenText).not.toHaveBeenCalled();
  });

  it("opens files whose bytes look binary as binary buffers", async () => {
    mocks.shouldInspectBytes = true;
    mocks.inspectFileOpenResource.mockResolvedValue({ isBinary: true, preloadedText: null });

    await fs().handleFileSelect("/work/app/blob.dat", false);

    expect(openedBuffer("/work/app/blob.dat")?.type).toBe("binary");
    expect(mocks.readFileOpenText).not.toHaveBeenCalled();
  });

  it("uses the inspected text and falls back to reading when inspection fails", async () => {
    mocks.shouldInspectBytes = true;
    mocks.inspectFileOpenResource
      .mockResolvedValueOnce({ isBinary: false, preloadedText: "preloaded" })
      .mockRejectedValueOnce(new Error("sniff failed"));
    mocks.readFileOpenText.mockImplementation(
      async (resource: { path: string }, preloaded: string | null) =>
        preloaded ?? `read ${resource.path}`,
    );

    await fs().handleFileSelect("/work/app/notes.txt", false);
    await fs().handleFileSelect("/work/app/other.txt", false);

    const notes = openedBuffer("/work/app/notes.txt");
    const other = openedBuffer("/work/app/other.txt");
    expect(notes?.type === "editor" && notes.content).toBe("preloaded");
    expect(other?.type === "editor" && other.content).toBe("read /work/app/other.txt");
  });
});

describe("renaming and moving folders with open files", () => {
  beforeEach(async () => {
    setDirectory("/work/app/src", [
      ["main.ts", false],
      ["lib", true],
    ]);
    setDirectory("/work/app/src/lib", [["util.ts", false]]);
    await fs().handleOpenFolderByPath("/work/app");
    await fs().toggleFolder("/work/app/src");
    await fs().toggleFolder("/work/app/src/lib");
    await fs().handleFileSelect("/work/app/src/lib/util.ts", false);
  });

  const treePaths = () => {
    const paths: string[] = [];
    const walk = (entries: FileEntry[]) => {
      for (const entry of entries) {
        paths.push(entry.path);
        if (entry.children) walk(entry.children);
      }
    };
    walk(fs().files);
    return paths;
  };

  it("points nested tree entries and open buffers at the renamed folder", async () => {
    await fs().handleRenamePath("/work/app/src", "source");

    expect(treePaths()).toContain("/work/app/source/lib/util.ts");
    expect(treePaths().some((path) => path.startsWith("/work/app/src"))).toBe(false);
    expect(buffersFor(activeWorkspaceId()!).map((buffer) => buffer.path)).toEqual([
      "/work/app/source/lib/util.ts",
    ]);
    expect(useFileTreeStore.getState().actions.isExpanded("/work/app/source/lib")).toBe(true);
  });

  it("points nested tree entries and open buffers at the moved folder", async () => {
    await fs().handleFileMove("/work/app/src/lib", "/work/app/lib");

    expect(treePaths()).toContain("/work/app/lib/util.ts");
    expect(treePaths()).not.toContain("/work/app/src/lib/util.ts");
    expect(buffersFor(activeWorkspaceId()!).map((buffer) => buffer.path)).toEqual([
      "/work/app/lib/util.ts",
    ]);
  });
});

describe("listing project files without the native index", () => {
  const wslRoot = "wsl://Ubuntu/home/me/app";

  beforeEach(() => {
    setDirectory(wslRoot, [
      ["src", true],
      ["node_modules", true],
      ["README.md", false],
      ["locked", true],
    ]);
    setDirectory(`${wslRoot}/src`, [["main.ts", false]]);
    mocks.unreadable.add(`${wslRoot}/locked`);
    useProjectStore.getState().actions.setRootFolderPath(wslRoot);
    useFileSystemStore.setState({ projectFilesCache: undefined });
  });

  it("scans the workspace once, skipping ignored and unreadable folders, then serves the cache", async () => {
    const files = await fs().getAllProjectFiles();

    expect(files.map((entry) => entry.path).sort()).toEqual([
      `${wslRoot}/README.md`,
      `${wslRoot}/src/main.ts`,
    ]);
    expect(mocks.reads).not.toContain(`${wslRoot}/node_modules`);
    expect(console.warn).toHaveBeenCalledWith(
      `Failed to scan directory ${wslRoot}/locked:`,
      expect.any(Error),
    );

    mocks.reads = [];
    expect(await fs().getAllProjectFiles()).toBe(files);
    expect(mocks.reads).toEqual([]);
  });

  it("returns stale results immediately and refreshes them in the background", async () => {
    const stale = [{ name: "old.ts", path: `${wslRoot}/old.ts`, isDir: false }];
    useFileSystemStore.setState({
      projectFilesCache: { path: wslRoot, files: stale, timestamp: Date.now() - 600_000 },
    });

    expect(await fs().getAllProjectFiles()).toEqual(stale);

    await vi.waitFor(() =>
      expect(
        fs()
          .projectFilesCache?.files.map((entry) => entry.name)
          .sort(),
      ).toEqual(["README.md", "main.ts"]),
    );
  });
});

describe("opening files in an external terminal editor", () => {
  beforeEach(async () => {
    await fs().handleOpenFolderByPath("/work/app");
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, externalEditor: "nvim" },
    }));
  });

  afterEach(() => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, externalEditor: "none", customEditorCommand: "" },
    }));
  });

  it("starts a terminal in the workspace and opens the file in it", async () => {
    vi.spyOn(commands, "createTerminal").mockResolvedValue("term-7");

    await fs().handleFileSelect("/work/app/notes.md", false);

    expect(commands.createTerminal).toHaveBeenCalledWith(
      expect.objectContaining({ workingDirectory: "/work/app" }),
      expect.anything(),
      expect.any(String),
      expect.any(String),
    );
    const buffer = getBufferByPath(buffersFor(activeWorkspaceId()!), "/work/app/notes.md");
    expect(buffer?.type).toBe("externalEditor");
    expect(mocks.readFileOpenText).not.toHaveBeenCalled();
  });

  it("falls back to the built-in editor when the terminal cannot start", async () => {
    vi.spyOn(commands, "createTerminal").mockRejectedValue(new Error("pty failed"));

    await fs().handleFileSelect("/work/app/notes.md", false);

    const buffer = getBufferByPath(buffersFor(activeWorkspaceId()!), "/work/app/notes.md");
    expect(buffer?.type).toBe("editor");
    expect(console.error).toHaveBeenCalledWith(
      "Failed to create external editor terminal:",
      expect.any(Error),
    );
  });

  it("uses the built-in editor when a custom editor has no command", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, externalEditor: "custom", customEditorCommand: "  " },
    }));
    const createTerminal = vi.spyOn(commands, "createTerminal");

    await fs().handleFileSelect("/work/app/notes.md", false);

    expect(createTerminal).not.toHaveBeenCalled();
    expect(getBufferByPath(buffersFor(activeWorkspaceId()!), "/work/app/notes.md")?.type).toBe(
      "editor",
    );
  });
});

describe("jumping to a location when opening a file", () => {
  it("places the caret at the requested line and column", async () => {
    await fs().handleOpenFolderByPath("/work/app");
    mocks.readFileOpenText.mockResolvedValue("first\nsecond line\nthird");
    const textarea = document.createElement("textarea");
    textarea.value = "first\nsecond line\nthird";
    document.body.appendChild(textarea);

    await fs().handleFileSelect("/work/app/a.txt", false, 2, 4, {
      current: { textarea } as never,
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));

    expect(textarea.selectionStart).toBe("first\n".length + 3);
    expect(document.activeElement).toBe(textarea);
    textarea.remove();
  });
});

describe("creating folders from the explorer", () => {
  beforeEach(async () => {
    await fs().handleOpenFolderByPath("/work/app");
  });

  it("adds a new-folder placeholder next to the selected file", async () => {
    useSidebarStore.getState().actions.updateActivePath("/work/app/README.md");

    await fs().handleCreateNewFolder();

    const placeholder = fs().files[0].children?.find((entry) => entry.isNewItem);
    expect(placeholder).toMatchObject({ isDir: true, isEditing: true, path: "/work/app/" });
  });

  it("asks for a folder name and creates it inside the directory", async () => {
    mocks.showPromptDialog.mockResolvedValueOnce(null).mockResolvedValueOnce("assets");

    await fs().handleCreateNewFolderInDirectory("/work/app");
    expect(fs().files[0].children?.some((entry) => entry.name === "assets")).toBe(false);

    await fs().handleCreateNewFolderInDirectory("/work/app");
    expect(fs().files[0].children?.find((entry) => entry.name === "assets")).toMatchObject({
      path: "/work/app/assets",
      isDir: true,
    });
  });
});
