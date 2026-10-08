import { toast } from "sonner";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { getSymlinkInfo } from "../controllers/platform";
import { useFileSystemStore } from "../stores/file-system.store";
import { useRecentFoldersStore } from "../stores/recent-folders.store";

/**
 * Opens a folder from the recent list, here or in a new window when that setting is on and a
 * workspace is already open. A folder that is gone is marked missing instead.
 */
export async function openRecentFolder(folderPath: string): Promise<void> {
  const recentActions = useRecentFoldersStore.getState().actions;
  try {
    const hasOpenWorkspace =
      !!useProjectStore.getState().rootFolderPath || useFileSystemStore.getState().files.length > 0;

    try {
      const pathInfo = await getSymlinkInfo(folderPath);
      if (!pathInfo.is_dir) {
        recentActions.updateRecentFolder(folderPath, { missing: true });
        toast.error(`Recent project is not a folder: ${folderPath}`);
        return;
      }
    } catch (error) {
      recentActions.updateRecentFolder(folderPath, { missing: true });
      console.error("Recent folder is no longer available:", folderPath, error);
      toast.error(`Recent project is unavailable: ${folderPath}`);
      return;
    }

    if (useSettingsStore.getState().settings.openFoldersInNewWindow && hasOpenWorkspace) {
      await createAppWindow({ path: folderPath, isDirectory: true });
      recentActions.addToRecents(folderPath, { missing: false, openInNewWindow: true });
      return;
    }

    const opened = await useFileSystemStore.getState().handleOpenFolderByPath(folderPath);
    if (opened) {
      recentActions.addToRecents(folderPath, { missing: false, openInNewWindow: false });
    }
  } catch (error) {
    console.error("Error opening recent folder:", error);
  }
}
