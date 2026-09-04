import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import * as appWindow from "@/features/window/utils/create-app-window";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import * as workspaceLifecycle from "@/features/workspace/services/workspace-lifecycle";
import * as platform from "../controllers/platform";
import { useFileSystemStore } from "../stores/file-system.store";
import { useRecentFoldersStore } from "../stores/recent-folders.store";

const currentPath = "/workspace/current";
const selectedPath = "/workspace/next";
const initialSettings = useSettingsStore.getState().settings;

describe("folder window routing", () => {
  beforeEach(() => {
    workspaceRuntimeRegistry.resetForTests();
    useWorkspaceTabsStore.setState({ projectTabs: [] });
    useFileSystemStore.setState({ rootFolderPath: currentPath, files: [] });
    useRecentFoldersStore.setState({ recentFolders: [] });
    useSettingsStore.setState({
      settings: { ...initialSettings, openFoldersInNewWindow: true },
    });
    vi.spyOn(platform, "openFolder").mockResolvedValue(selectedPath);
    vi.spyOn(platform, "getSymlinkInfo").mockResolvedValue({
      is_symlink: false,
      is_dir: true,
    });
    vi.spyOn(appWindow, "createAppWindow").mockResolvedValue("main-1");
    vi.spyOn(workspaceLifecycle, "openWorkspaceRuntime").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSettingsStore.setState({ settings: initialSettings });
    workspaceRuntimeRegistry.resetForTests();
  });

  for (const source of ["picker", "recent"] as const) {
    const openSelectedFolder = () =>
      source === "picker"
        ? useFileSystemStore.getState().handleOpenFolder()
        : useRecentFoldersStore.getState().actions.openRecentFolder(selectedPath);

    it(`${source}: opens a separate window when the setting is enabled`, async () => {
      await openSelectedFolder();

      expect(appWindow.createAppWindow).toHaveBeenCalledExactlyOnceWith({
        path: selectedPath,
        isDirectory: true,
      });
      expect(workspaceLifecycle.openWorkspaceRuntime).not.toHaveBeenCalled();
      expect(useFileSystemStore.getState().rootFolderPath).toBe(currentPath);
    });

    it(`${source}: uses the current window when the setting is disabled`, async () => {
      useSettingsStore.setState({
        settings: { ...initialSettings, openFoldersInNewWindow: false },
      });

      await openSelectedFolder();

      expect(appWindow.createAppWindow).not.toHaveBeenCalled();
      expect(workspaceLifecycle.openWorkspaceRuntime).toHaveBeenCalledWith(
        expect.objectContaining({ descriptor: { path: selectedPath, name: "next" } }),
      );
    });

    it(`${source}: opens the first folder in the empty window even when enabled`, async () => {
      useFileSystemStore.setState({ rootFolderPath: undefined });

      await openSelectedFolder();

      expect(appWindow.createAppWindow).not.toHaveBeenCalled();
      expect(workspaceLifecycle.openWorkspaceRuntime).toHaveBeenCalledOnce();
    });
  }

  it("does not open either destination when the picker is cancelled", async () => {
    vi.mocked(platform.openFolder).mockResolvedValue(null);

    await expect(useFileSystemStore.getState().handleOpenFolder()).resolves.toBe(false);

    expect(appWindow.createAppWindow).not.toHaveBeenCalled();
    expect(workspaceLifecycle.openWorkspaceRuntime).not.toHaveBeenCalled();
  });

  it("preserves the current workspace if new-window creation fails", async () => {
    const error = new Error("Window creation failed");
    vi.mocked(appWindow.createAppWindow).mockRejectedValue(error);

    await expect(useFileSystemStore.getState().handleOpenFolder()).rejects.toBe(error);

    expect(workspaceLifecycle.openWorkspaceRuntime).not.toHaveBeenCalled();
    expect(useFileSystemStore.getState().rootFolderPath).toBe(currentPath);
  });
});
