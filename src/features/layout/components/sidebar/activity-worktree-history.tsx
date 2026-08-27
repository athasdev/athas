import { useEffect, useMemo, useState } from "react";
import { getWorktrees } from "@/features/git/api/git-worktrees-api";
import { isGitChangeRelevant, subscribeToGitChanges } from "@/features/git/events/git-events";
import type { GitWorktree } from "@/features/git/types/git.types";
import { isOpenableGitWorktree } from "@/features/git/utils/git-worktree-open";
import { ActivitySidebarSection } from "@/features/layout/components/sidebar/activity-sidebar-section";
import { WorktreeItem } from "@/features/layout/components/sidebar/worktree-item";
import { NodesIcon, PlusIcon } from "@/ui/icons";
import { SidebarIconButton, SidebarListItem } from "@/ui/sidebar";

export function ActivityWorktreeHistory({
  repoPath,
  onNewWorktree,
}: {
  repoPath: string | null;
  onNewWorktree: () => void;
}) {
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const openableWorktrees = useMemo(() => worktrees.filter(isOpenableGitWorktree), [worktrees]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!repoPath) {
        if (!cancelled) setWorktrees([]);
        return;
      }

      const nextWorktrees = await getWorktrees(repoPath);
      if (!cancelled) setWorktrees(nextWorktrees);
    };

    void load();
    const unsubscribe = subscribeToGitChanges((change) => {
      if (isGitChangeRelevant(change, repoPath)) void load();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [repoPath]);

  return (
    <ActivitySidebarSection
      id="worktrees"
      title="Worktrees"
      action={
        openableWorktrees.length > 0 ? (
          <SidebarIconButton
            tooltip="New Worktree"
            tooltipSide="right"
            aria-label="New Worktree"
            onClick={onNewWorktree}
          >
            <PlusIcon />
          </SidebarIconButton>
        ) : undefined
      }
    >
      {openableWorktrees.length === 0 ? (
        <SidebarListItem leading={<NodesIcon />} onClick={onNewWorktree} aria-label="New Worktree">
          New Worktree
        </SidebarListItem>
      ) : null}
      {repoPath
        ? openableWorktrees.map((worktree) => (
            <WorktreeItem key={worktree.path} repoPath={repoPath} worktree={worktree} />
          ))
        : null}
    </ActivitySidebarSection>
  );
}
