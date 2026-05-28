import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { createAppWindow } from "@/features/window/utils/create-app-window";

type GitWorktreeOpenTarget = "current-window" | "new-window";

interface OpenGitWorktreeOptions {
  target?: GitWorktreeOpenTarget;
}

export async function openGitWorktreeWorkspace(
  worktreePath: string,
  options: OpenGitWorktreeOptions = {},
): Promise<boolean> {
  const path = worktreePath.trim();
  if (!path) return false;

  if (options.target === "new-window") {
    await createAppWindow({
      path,
      isDirectory: true,
    });
    return true;
  }

  const opened = await useFileSystemStore.getState().handleOpenFolderByPath(path);
  if (!opened) return false;

  useRepositoryStore.getState().actions.selectRepository(path);
  return true;
}
