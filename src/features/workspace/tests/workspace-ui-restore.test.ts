// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: vi.fn().mockResolvedValue([]),
      transformCallback: vi.fn(),
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const harness = vi.hoisted(() => ({
  switchToProject: vi.fn(async () => true),
  handleOpenFolderByPath: vi.fn(async () => true),
  getConnection: vi.fn(),
  connectRemoteConnection: vi.fn(async () => {}),
}));

vi.mock("@/features/file-system/stores/file-system.store", () => ({
  useFileSystemStore: {
    getState: () => ({
      switchToProject: harness.switchToProject,
      handleOpenFolderByPath: harness.handleOpenFolderByPath,
    }),
  },
}));
vi.mock("@/features/remote/stores/remote-connection.store", () => ({
  connectionStore: { getConnection: harness.getConnection },
}));
vi.mock("@/features/workspace/services/remote-connection-actions", () => ({
  connectRemoteConnection: harness.connectRemoteConnection,
}));

import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { workspaceRuntimeRegistry } from "../services/workspace-runtime-registry";
import { workspaceSessionRepository } from "../persistence/services/workspace-session-repository";
import {
  getCurrentProjectUiState,
  persistCurrentProjectUiState,
  restoreProjectPaneState,
  restoreProjectUiState,
} from "../persistence/services/workspace-ui-session";
import { useWorkspaceTabsStore } from "../stores/workspace-tabs.store";
import { openManagedWorkspace } from "../team/services/open-managed-workspace";

beforeEach(() => {
  vi.clearAllMocks();
  workspaceRuntimeRegistry.resetForTests();
  useWorkspaceTabsStore.setState({ projectTabs: [] });
});

afterEach(() => {
  workspaceRuntimeRegistry.resetForTests();
});

describe("project UI session", () => {
  it("captures the current panel layout and saves it per project", () => {
    const ui = useUIState.getState();
    ui.setIsSidebarVisible(false);
    ui.setIsBottomPaneVisible(true);
    ui.setBottomPaneActiveTab("terminal");
    ui.setActiveView("git");

    const captured = getCurrentProjectUiState();
    expect(captured).toMatchObject({
      isSidebarVisible: false,
      isBottomPaneVisible: true,
      bottomPaneActiveTab: "terminal",
      activeSidebarView: "git",
    });
    expect(captured.paneState).toBeDefined();

    persistCurrentProjectUiState(undefined);
    persistCurrentProjectUiState("/projects/ui-a");
    expect(workspaceSessionRepository.loadUi("/projects/ui-a")).toMatchObject({
      isSidebarVisible: false,
      activeSidebarView: "git",
    });
  });

  it("reads a specific workspace's stores when asked", () => {
    workspaceRuntimeRegistry.ensureWorkspace({ id: "ws-b", name: "b" }, "ready");
    useUIState.getStore("ws-b").getState().setActiveView("github-prs");

    expect(getCurrentProjectUiState("ws-b").activeSidebarView).toBe("github-prs");
    expect(getCurrentProjectUiState().activeSidebarView).not.toBe("github-prs");
  });

  it("restores saved panels and maps retired sidebar views", () => {
    workspaceSessionRepository.saveUi("/projects/ui-legacy", {
      isSidebarVisible: true,
      isBottomPaneVisible: false,
      bottomPaneActiveTab: "terminal",
      activeSidebarView: "debugger" as never,
    });

    restoreProjectUiState("/projects/ui-legacy");

    expect(useUIState.getState()).toMatchObject({
      isSidebarVisible: true,
      isBottomPaneVisible: true,
      bottomPaneActiveTab: "debugger",
      activeSidebarView: "files",
    });

    workspaceSessionRepository.saveUi("/projects/ui-sources", {
      isSidebarVisible: false,
      isBottomPaneVisible: false,
      bottomPaneActiveTab: "terminal",
      activeSidebarView: "data-sources" as never,
    });
    restoreProjectUiState("/projects/ui-sources");
    expect(useUIState.getState()).toMatchObject({
      isSidebarVisible: false,
      activeSidebarView: "views",
    });

    workspaceSessionRepository.saveUi("/projects/ui-ext", {
      isSidebarVisible: true,
      isBottomPaneVisible: false,
      bottomPaneActiveTab: "terminal",
      activeSidebarView: "extensions" as never,
    });
    restoreProjectUiState("/projects/ui-ext");
    expect(useUIState.getState().activeSidebarView).toBe("files");
  });

  it("falls back to default panels for projects without a saved session", () => {
    useUIState.getState().setIsSidebarVisible(false);

    restoreProjectUiState("/projects/never-opened");

    expect(useUIState.getState().isSidebarVisible).toBe(true);
  });

  it("restores the saved pane layout around reopened buffers", () => {
    useBufferStore.setState({
      buffers: [
        { id: "buf-a", path: "/p/a.ts", type: "editor", name: "a.ts" },
        { id: "buf-b", path: "/p/b.ts", type: "editor", name: "b.ts" },
      ] as never,
    });
    usePaneStore.getState().actions.addBufferToPane(ROOT_PANE_ID, "buf-a");
    usePaneStore.getState().actions.addBufferToPane(ROOT_PANE_ID, "buf-b");
    persistCurrentProjectUiState("/projects/panes");

    restoreProjectPaneState("/projects/panes");

    const root = usePaneStore.getState().root;
    expect(root.type).toBe("group");
    expect(root.type === "group" ? root.bufferIds : []).toEqual(["buf-a", "buf-b"]);
  });
});

describe("openManagedWorkspace", () => {
  it("switches to an already open workspace tab", async () => {
    useWorkspaceTabsStore.getState().actions.addProjectTab("/projects/team", "team");
    const id = useWorkspaceTabsStore.getState().projectTabs[0].id;

    await openManagedWorkspace("/projects/team/");

    expect(harness.switchToProject).toHaveBeenCalledWith(id);
    expect(harness.handleOpenFolderByPath).not.toHaveBeenCalled();
  });

  it("fails when switching to the open workspace fails", async () => {
    useWorkspaceTabsStore.getState().actions.addProjectTab("/projects/team", "team");
    harness.switchToProject.mockResolvedValueOnce(false);

    await expect(openManagedWorkspace("/projects/team")).rejects.toThrow(
      "Could not open workspace.",
    );
  });

  it("opens local folders and can show workspace management", async () => {
    await openManagedWorkspace("/projects/new");
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.type === "workspaces")).toBe(
      false,
    );

    await openManagedWorkspace("/projects/new", true);

    expect(harness.handleOpenFolderByPath).toHaveBeenCalledWith("/projects/new");
    expect(useBufferStore.getState().buffers.some((buffer) => buffer.type === "workspaces")).toBe(
      true,
    );

    harness.handleOpenFolderByPath.mockResolvedValueOnce(false);
    await expect(openManagedWorkspace("/projects/missing")).rejects.toThrow(
      "Could not open workspace.",
    );
  });

  it("connects to remote workspaces through their saved connection", async () => {
    const connection = { id: "ssh-1", name: "box" };
    harness.getConnection.mockResolvedValueOnce(connection).mockResolvedValueOnce(null);

    await openManagedWorkspace("remote://ssh-1/home/dev/app");
    expect(harness.connectRemoteConnection).toHaveBeenCalledWith(connection);

    await expect(openManagedWorkspace("remote://ssh-1/home/dev/app")).rejects.toThrow(
      "The SSH connection is no longer available. Add it in Environments.",
    );
  });
});

describe("workspace tabs", () => {
  it("reactivates and renames a tab when its folder is opened again", () => {
    const { actions } = useWorkspaceTabsStore.getState();
    actions.addProjectTab("/projects/a", "a");
    actions.addProjectTab("/projects/b", "b", "dark");
    actions.addProjectTab("/projects/a/", "renamed");

    const tabs = useWorkspaceTabsStore.getState().projectTabs;
    expect(tabs.map((tab) => [tab.name, tab.isActive])).toEqual([
      ["renamed", true],
      ["b", false],
    ]);
    expect(tabs[1].theme).toBe("dark");
    expect(actions.getActiveProjectTab()?.name).toBe("renamed");
    expect(actions.hasProjectTab("/projects/b")).toBe(true);
    expect(actions.hasProjectTab("/projects/c")).toBe(false);
  });

  it("stores custom icons and themes on existing tabs only", () => {
    const { actions } = useWorkspaceTabsStore.getState();
    actions.addProjectTab("/projects/a", "a");
    const id = useWorkspaceTabsStore.getState().projectTabs[0].id;

    actions.setProjectIcon(id, "/projects/a/icon.png");
    actions.setProjectTheme(id, "solarized");
    actions.setProjectIcon("missing", "/x.png");
    actions.setProjectTheme("missing", "x");

    expect(useWorkspaceTabsStore.getState().projectTabs).toEqual([
      expect.objectContaining({ customIcon: "/projects/a/icon.png", theme: "solarized" }),
    ]);

    actions.setProjectIcon(id, undefined);
    expect(useWorkspaceTabsStore.getState().projectTabs[0].customIcon).toBeUndefined();
  });

  it("renames remote tabs when their connection is renamed and removes tabs", () => {
    const { actions } = useWorkspaceTabsStore.getState();
    actions.addProjectTab("remote://ssh-1/home/app", "old-box: app");
    actions.addProjectTab("/projects/local", "local");

    actions.renameRemoteProjectTabs("ssh-1", "new-box");
    expect(useWorkspaceTabsStore.getState().projectTabs[0].name).toContain("new-box");

    actions.removeProjectTab(useWorkspaceTabsStore.getState().projectTabs[0].id);
    expect(useWorkspaceTabsStore.getState().projectTabs.map((tab) => tab.name)).toEqual(["local"]);

    actions.addProjectTab("/projects/other", "other");
    actions.reorderProjectTabs(1, 0);
    expect(useWorkspaceTabsStore.getState().projectTabs.map((tab) => tab.name)).toEqual([
      "other",
      "local",
    ]);
  });
});
