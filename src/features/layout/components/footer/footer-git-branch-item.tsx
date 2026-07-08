import { getGitStatus } from "@/features/git/api/git-status-api";
import GitBranchManager from "@/features/git/components/git-branch-manager";
import { useGitStore } from "@/features/git/stores/git.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { openGitWorktreeWorkspace } from "@/features/git/utils/git-worktree-open";
import type { FooterLeadingItemId } from "@/features/layout/config/item-order";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { FooterItem } from "./footer-items";

export function useFooterGitBranchItem(): FooterItem<FooterLeadingItemId> | null {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const gitStatus = useGitStore((state) => state.gitStatus);
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const currentRepoPath = useGitStore((state) => state.currentRepoPath);
  const currentWorkspaceRepoPath = useGitStore((state) => state.currentWorkspaceRepoPath);
  const actions = useGitStore((state) => state.actions);
  const footerRepoPath = activeRepoPath ?? currentWorkspaceRepoPath ?? rootFolderPath;
  const footerGitStatus =
    activeRepoPath && currentRepoPath === activeRepoPath && gitStatus
      ? gitStatus
      : workspaceGitStatus;
  const footerBranch = footerGitStatus?.branch;

  if (!footerRepoPath || !footerBranch) return null;

  return {
    id: "branch",
    label: "Git branch",
    content: (
      <GitBranchManager
        currentBranch={footerBranch}
        repoPath={footerRepoPath}
        paletteTarget
        triggerSurface="footer"
        onBranchChange={async () => {
          const status = await getGitStatus(footerRepoPath);
          actions.setWorkspaceGitStatus(status, footerRepoPath);
          if (currentRepoPath === footerRepoPath) {
            actions.setGitStatus(status);
          }
        }}
        onWorktreeChange={async (worktreePath) => {
          const opened = await openGitWorktreeWorkspace(worktreePath);
          if (!opened) return;

          const status = await getGitStatus(worktreePath);
          actions.setWorkspaceGitStatus(status, worktreePath);
          if (currentRepoPath === footerRepoPath) {
            actions.setGitStatus(status);
          }
        }}
        onRepositoryChange={async (repoPath) => {
          if (!repoPath) return;

          const status = await getGitStatus(repoPath);
          actions.setWorkspaceGitStatus(status, repoPath);
          if (currentRepoPath === repoPath) {
            actions.setGitStatus(status);
          }
        }}
      />
    ),
  };
}
