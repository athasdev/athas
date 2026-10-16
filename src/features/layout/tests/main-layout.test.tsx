// @vitest-environment jsdom
import { within } from "@testing-library/dom";
import { enableMapSet } from "immer";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useBootstrapPhaseStore } from "@/features/bootstrap/stores/bootstrap-phase.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { useGitStore } from "@/features/git/stores/git.store";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import {
  type ProjectTab,
  useWorkspaceTabsStore,
} from "@/features/workspace/stores/workspace-tabs.store";
import { useUIState } from "../stores/ui-state.store";

const io = vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: (cmd: string) => Promise.resolve(cmd.includes("get_all") ? [] : null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
  return {
    paths: new Map<string, { is_dir: boolean }>(),
    drop: null as null | ((paths: string[]) => Promise<void>),
    draggingOver: false,
    dropEnabled: [] as boolean[],
    debuggerBridges: 0,
  };
});

const stub = (label: string) => () => <div data-testid={label} />;

vi.mock("@/features/file-system/api/file-system-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/file-system/api/file-system-api")>()),
  getSymlinkInfo: async (path: string) => {
    const info = io.paths.get(path);
    if (!info) throw new Error(`missing ${path}`);
    return info;
  },
}));
vi.mock("@/features/file-system/hooks/use-file-system-folder-drop", () => ({
  useFileSystemFolderDrop: (onDrop: (paths: string[]) => Promise<void>, enabled: boolean) => {
    io.drop = onDrop;
    io.dropEnabled.push(enabled);
    return { isDraggingOver: io.draggingOver };
  },
}));
vi.mock("@/features/debugger/services/debug-adapter-events", () => ({
  initializeDebuggerEventBridge: async () => {
    io.debuggerBridges++;
  },
}));
vi.mock("@/features/ai/hooks/use-chat-initialization", () => ({ useChatInitialization: () => {} }));
vi.mock("@/features/ai/session-panel/hooks/use-session-panel-runtime", () => ({
  useSessionPanelRuntime: () => {},
}));
vi.mock("@/features/ai/hooks/use-running-agent-project-ids", () => ({
  useRunningAgentProjectIds: () => [],
}));
vi.mock("@/features/collaboration/hooks/use-collaboration-presence", () => ({
  useCollaborationPresence: () => {},
}));
vi.mock("@/features/window/hooks/use-menu-events-wrapper", () => ({
  useMenuEventsWrapper: () => {},
}));
vi.mock("@/features/window/components/title-bar/title-bar", () => ({
  default: stub("title-bar"),
}));
vi.mock("@/features/window/components/title-bar/title-leading", () => ({
  TitleLeading: stub("title-leading"),
}));
vi.mock("../components/performance-monitor", () => ({ PerformanceMonitor: stub("perf") }));
vi.mock("../components/sidebar/workbench-sidebar", () => ({
  WorkbenchSidebar: stub("sidebar"),
  ProjectPickerHost: stub("project-picker-host"),
}));
vi.mock("../components/dock/workbench-dock", () => ({
  WorkbenchDock: stub("dock"),
  useDockCoversCentre: () => false,
}));
vi.mock("../components/resizable-pane", () => ({
  ResizablePane: ({ hidden, children }: { hidden: boolean; children: ReactNode }) =>
    hidden ? null : <div>{children}</div>,
}));
vi.mock("@/features/panes/components/split-view-root", () => ({
  CachedWorkspaceSplitViews: stub("split-views"),
}));
vi.mock("../components/bottom-pane/bottom-pane", () => ({ default: stub("bottom-pane") }));
vi.mock("@/features/command-palette/components/command-palette", () => ({
  default: stub("command-palette"),
}));
vi.mock("@/features/database/components/connection/connection-dialog", () => ({
  ConnectionDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
    isOpen ? (
      <button type="button" onClick={onClose}>
        Close database connection
      </button>
    ) : null,
}));
vi.mock("@/features/file-system/components/linux-folder-picker-dialog", () => ({
  default: stub("linux-picker"),
}));
vi.mock("@/features/previews/components/previews-host", () => ({ PreviewsHost: stub("previews") }));
vi.mock("@/features/quick-open/components/quick-open", () => ({ default: stub("quick-open") }));
vi.mock("@/features/window/components/window-close-guard", () => ({
  WindowCloseGuard: stub("close-guard"),
}));
vi.mock("@/features/settings/components/settings-dialog", () => ({
  SettingsDialog: stub("settings-dialog"),
}));
vi.mock("@/features/tabs/components/pending-buffer-close-dialog", () => ({
  PendingBufferCloseDialog: stub("pending-close"),
}));
vi.mock("@/extensions/ui/components/extension-dialog", () => ({
  ExtensionDialogs: stub("extension-dialogs"),
}));
vi.mock("@/features/terminal/components/terminal-host", () => ({
  TerminalHost: stub("terminal-host"),
}));

const { MainLayout } = await import("../components/main-layout");

enableMapSet();

const last = <T,>(items: readonly T[]): T | undefined => items[items.length - 1];

let root: Root;
let container: HTMLDivElement;
let fileSystem: {
  switched: string[];
  switching: boolean[];
  folders: string[];
  files: string[];
  failSwitch: boolean;
};
let git: { refreshed: string[]; cleared: number };

async function wait(ms = 0) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    for (let index = 0; index < 4; index++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function render() {
  await act(async () => root.render(<MainLayout />));
  await wait();
}

const view = () => within(container);

const tab = (id: string, path: string, isActive = false): ProjectTab => ({
  id,
  name: id,
  path,
  isActive,
  lastOpened: 1,
});

async function reachSettings() {
  await act(async () => useBootstrapPhaseStore.getState().actions.reachPhase("settings-ready"));
  await wait();
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  workspaceRuntimeRegistry.resetForTests();
  useBootstrapPhaseStore.setState({ phase: "booting" });
  io.paths = new Map();
  io.drop = null;
  io.draggingOver = false;
  io.dropEnabled = [];
  io.debuggerBridges = 0;
  fileSystem = { switched: [], switching: [], folders: [], files: [], failSwitch: false };
  git = { refreshed: [], cleared: 0 };
  useWorkspaceTabsStore.setState({ projectTabs: [] });
  useProjectStore.setState({ rootFolderPath: undefined });
  useFileSystemStore.setState({
    switchToProject: async (id: string) => {
      fileSystem.switched.push(id);
      if (fileSystem.failSwitch) throw new Error("cannot switch");
      return true;
    },
    setIsSwitchingProject: (value: boolean) => fileSystem.switching.push(value),
    handleOpenFolderByPath: async (path: string) => {
      fileSystem.folders.push(path);
      return true;
    },
    handleFileOpen: async (path: string) => {
      fileSystem.files.push(path);
    },
  } as never);
  const gitActions = useGitStore.getState().actions;
  useGitStore.setState({
    actions: {
      ...gitActions,
      refreshWorkspaceGitStatus: async (path: string) => {
        git.refreshed.push(path);
      },
      setWorkspaceGitStatus: () => {
        git.cleared++;
      },
    },
  } as never);
  Element.prototype.getAnimations = () => [];
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("main layout", () => {
  it("lays out the workbench and mounts the deferred surfaces after the first paint", async () => {
    await render();
    expect(view().getByTestId("title-leading")).toBeTruthy();
    expect(view().getByTestId("split-views")).toBeTruthy();
    expect(view().getByTestId("sidebar")).toBeTruthy();
    expect(view().getByTestId("dock")).toBeTruthy();
    expect(view().getByTestId("project-picker-host")).toBeTruthy();
    await wait(30);
    expect(view().getByTestId("bottom-pane")).toBeTruthy();
    expect(view().getByTestId("quick-open")).toBeTruthy();
    expect(view().getByTestId("terminal-host")).toBeTruthy();
    expect(io.debuggerBridges).toBe(1);
    expect(git.cleared).toBeGreaterThan(0);

    await act(async () => {
      useUIState.getState().setIsSidebarVisible(false);
    });
    expect(view().queryByTestId("sidebar")).toBeNull();
  });

  it("opens and closes the database connection dialog", async () => {
    await render();
    await wait(30);
    await act(async () => useUIState.getState().setIsDatabaseConnectionVisible(true));
    await wait();
    await act(async () =>
      view().getByRole("button", { name: "Close database connection" }).click(),
    );
    expect(useUIState.getState().isDatabaseConnectionVisible).toBe(false);
  });

  it("restores the active project once settings are ready", async () => {
    io.paths.set("/code/web", { is_dir: true });
    useWorkspaceTabsStore.setState({ projectTabs: [tab("web", "/code/web", true)] });
    await render();
    expect(fileSystem.switched).toEqual([]);
    await reachSettings();
    expect(fileSystem.switching).toEqual([true]);
    expect(fileSystem.switched).toEqual(["web"]);

    await reachSettings();
    expect(fileSystem.switched).toEqual(["web"]);
  });

  it("drops projects that no longer exist and restores the next one", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => 1);
    io.paths.set("/code/api", { is_dir: true });
    io.paths.set("/code/file.txt", { is_dir: false });
    useWorkspaceTabsStore.setState({
      projectTabs: [
        tab("gone", "/code/gone", true),
        tab("file", "/code/file.txt"),
        tab("api", "/code/api"),
      ],
    });
    useBootstrapPhaseStore.setState({ phase: "settings-ready" });
    await render();
    await wait(10);
    expect(warning).toHaveBeenCalledWith('Removed missing project "gone"');
    expect(useWorkspaceTabsStore.getState().projectTabs.map((project) => project.id)).not.toContain(
      "gone",
    );
    expect(fileSystem.switched.length).toBe(1);
    expect(["file", "api"]).toContain(fileSystem.switched[0]);
  });

  it("restores remote projects without checking the disk and recovers from a failed switch", async () => {
    fileSystem.failSwitch = true;
    useWorkspaceTabsStore.setState({ projectTabs: [tab("box", "remote://box/", true)] });
    useBootstrapPhaseStore.setState({ phase: "settings-ready" });
    await render();
    await wait(10);
    expect(fileSystem.switched).toEqual(["box"]);
    expect(fileSystem.switching).toEqual([true, false]);
  });

  it("starts without a project when none was open", async () => {
    useBootstrapPhaseStore.setState({ phase: "settings-ready" });
    await render();
    await wait(10);
    expect(fileSystem.switched).toEqual([]);
  });

  it("opens dropped folders and files and warns when nothing could be opened", async () => {
    const warning = vi.spyOn(toast, "warning").mockImplementation(() => 1);
    io.paths.set("/drop/project", { is_dir: true });
    io.paths.set("/drop/notes.md", { is_dir: false });
    await render();
    expect(last(io.dropEnabled)).toBe(true);
    await act(async () => io.drop?.(["/drop/project", "/drop/notes.md"]));
    expect(fileSystem.folders).toEqual(["/drop/project"]);
    expect(fileSystem.files).toEqual(["/drop/notes.md"]);
    expect(warning).not.toHaveBeenCalled();

    await act(async () => io.drop?.([]));
    await act(async () => io.drop?.(["/drop/missing"]));
    expect(warning).toHaveBeenCalledWith("No supported dropped files or folders could be opened.");
  });

  it("shows the drop overlay while files are dragged over the window", async () => {
    io.draggingOver = true;
    await render();
    expect(view().getByText("Drop folder to open project, or file to open buffer")).toBeTruthy();
  });

  it("refreshes git status after relevant repository changes", async () => {
    useProjectStore.setState({ rootFolderPath: "/code/web" });
    await render();
    expect(last(io.dropEnabled)).toBe(false);
    await act(async () => emitGitChanged({ repoPath: "/code/other" }));
    await act(async () => emitGitChanged({ repoPath: "/code/web" }));
    await wait(350);
    expect(git.refreshed).toEqual(["/code/web"]);
  });

  it("opens a pending onboarding request as a tab", async () => {
    await render();
    await act(async () =>
      useOnboardingStore.setState({ isOpen: true, context: { kind: "first-run" } as never }),
    );
    await wait();
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.type === "onboarding")).toBe(
      true,
    );
    expect(useOnboardingStore.getState().isOpen).toBe(false);
  });

  it("follows the relative line number setting in vim mode", async () => {
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, vimRelativeLineNumbers: true },
    }));
    await render();
    expect(useVimStore.getState().relativeLineNumbers).toBe(true);
    useSettingsStore.setState((state) => ({
      settings: { ...state.settings, vimRelativeLineNumbers: false },
    }));
    await wait();
    expect(useVimStore.getState().relativeLineNumbers).toBe(false);
  });
});
