import { Button } from "@/ui/button";
import { FilesIcon, InfoIcon } from "@/ui/icons";
import type { Commit } from "../types/github-pr-viewer.types";
import { PRCommitsDropdown } from "./pr-commits-dropdown";

interface GitHubPRTabsProps {
  activeView: "activity" | "files";
  commits: Commit[];
  repoPath?: string;
  additions: number;
  deletions: number;
  onShowOverview: () => void;
  onShowChanges: () => void;
}

export function GitHubPRTabs({
  activeView,
  commits,
  repoPath,
  additions,
  deletions,
  onShowOverview,
  onShowChanges,
}: GitHubPRTabsProps) {
  return (
    <div className="flex min-w-0 items-center gap-1 py-1">
      <Button
        type="button"
        variant="ghost"
        size="chrome"
        active={activeView === "activity"}
        aria-pressed={activeView === "activity"}
        onClick={onShowOverview}
      >
        <InfoIcon />
        Overview
      </Button>
      <PRCommitsDropdown commits={commits} repoPath={repoPath} />
      <Button
        type="button"
        variant="ghost"
        size="chrome"
        active={activeView === "files"}
        aria-pressed={activeView === "files"}
        onClick={onShowChanges}
      >
        <FilesIcon />
        Changes
        <span className="flex items-center gap-1 font-mono">
          <span className="text-git-added">{`+${additions}`}</span>
          <span className="text-git-deleted">{`-${deletions}`}</span>
        </span>
      </Button>
    </div>
  );
}
