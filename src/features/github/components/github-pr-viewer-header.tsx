import { Button } from "@/ui/button";
import { DropdownMenuItem } from "@/ui/dropdown";
import { FilesIcon, InfoIcon } from "@/ui/icons";
import type { Commit } from "../types/github-pr-viewer.types";
import type { PullRequestDetails } from "../types/github.types";
import { getTimeAgo } from "../utils/github-viewer-utils";
import {
  GitHubViewerActionsMenu,
  GitHubViewerHeader,
  GitHubViewerTitle,
} from "./github-viewer-shell";
import { PRCommitsDropdown } from "./pr-commits-dropdown";

interface GitHubPRViewerHeaderProps {
  pr: PullRequestDetails;
  activeView: "activity" | "files";
  changedFilesCount: number;
  commits: Commit[];
  repoPath?: string;
  additions: number;
  deletions: number;
  isRefreshingDetails: boolean;
  onRefresh: () => void;
  onCheckout: () => void;
  onOpenInBrowser: () => void;
  onCopyPRLink: () => void;
  onCopyBranchName: () => void;
  onShowOverview: () => void;
  onShowFiles: () => void;
  onComment: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onMerge: () => void;
  onClosePR: () => void;
}

export function GitHubPRViewerHeader({
  pr,
  activeView,
  changedFilesCount,
  commits,
  repoPath,
  additions,
  deletions,
  isRefreshingDetails,
  onRefresh,
  onCheckout,
  onOpenInBrowser,
  onCopyPRLink,
  onCopyBranchName,
  onShowOverview,
  onShowFiles,
  onComment,
  onApprove,
  onRequestChanges,
  onMerge,
  onClosePR,
}: GitHubPRViewerHeaderProps) {
  const isClosed = pr.state === "closed";
  const canMerge = !isClosed && !pr.isDraft && pr.mergeable !== "CONFLICTING";

  return (
    <GitHubViewerHeader
      title={
        <GitHubViewerTitle
          kind="Pull request"
          number={pr.number}
          title={pr.title}
          stats={
            <span className="flex items-center gap-1.5 font-mono">
              <span className="text-git-added">+{additions}</span>
              <span className="text-git-deleted">-{deletions}</span>
            </span>
          }
        />
      }
      meta={
        <>
          <span>{pr.isDraft ? "Draft" : pr.state}</span>
          <span>&middot;</span>
          <span>{`Updated ${getTimeAgo(pr.updatedAt)}`}</span>
          <span>&middot;</span>
          <span className="font-mono">{`${pr.baseRef} ← ${pr.headRef}`}</span>
        </>
      }
      actions={
        <GitHubViewerActionsMenu label="Pull request actions">
          <DropdownMenuItem disabled={isRefreshingDetails} onClick={onRefresh}>
            {isRefreshingDetails ? "Refreshing..." : "Refresh"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onCheckout}>Checkout branch</DropdownMenuItem>
          <DropdownMenuItem disabled={isClosed} onClick={onApprove}>
            Approve
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isClosed} onClick={onRequestChanges}>
            Request changes
          </DropdownMenuItem>
          <DropdownMenuItem disabled={isClosed} onClick={onClosePR}>
            Close pull request
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenInBrowser}>Open on GitHub</DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyPRLink}>Copy link</DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyBranchName}>Copy branch name</DropdownMenuItem>
        </GitHubViewerActionsMenu>
      }
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-chrome">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            shape="pill"
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
            size="xs"
            shape="pill"
            active={activeView === "files"}
            aria-pressed={activeView === "files"}
            onClick={onShowFiles}
          >
            <FilesIcon />
            {`Files ${changedFilesCount}`}
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button onClick={onComment} disabled={isClosed} variant="ghost" size="xs" shape="pill">
            Comment
          </Button>
          <Button onClick={onMerge} disabled={!canMerge} variant="accent" size="xs" shape="pill">
            Merge
          </Button>
        </div>
      </div>
    </GitHubViewerHeader>
  );
}
