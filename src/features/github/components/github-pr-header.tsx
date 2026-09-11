import { Button } from "@/ui/button";
import { DropdownMenuItem } from "@/ui/dropdown";
import { FilesIcon, InfoIcon } from "@/ui/icons";
import { ResourceActionsMenu, ResourceHeader } from "@/ui/resource";
import { Spinner } from "@/ui/spinner";
import type { Commit } from "../types/github-pr-viewer.types";
import type { PullRequestDetails } from "../types/github.types";
import { PULL_REQUEST_STATUS_LABEL, getPullRequestStatus } from "../utils/github-pr-viewer-utils";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { PRCommitsDropdown } from "./pr-commits-dropdown";

interface GitHubPRHeaderProps {
  pr: PullRequestDetails;
  activeView: "activity" | "files";
  changedFilesCount: number;
  commits: Commit[];
  repoPath?: string;
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

export function GitHubPRHeader({
  pr,
  activeView,
  changedFilesCount,
  commits,
  repoPath,
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
}: GitHubPRHeaderProps) {
  const status = getPullRequestStatus(pr);
  const isClosed = status === "closed" || status === "merged";
  const canMerge = status === "open" && pr.mergeable !== "CONFLICTING" && pr.mergeable !== "false";

  return (
    <ResourceHeader
      title={pr.title}
      meta={
        <>
          <span>{`#${pr.number}`}</span>
          <span>&middot;</span>
          <span>{PULL_REQUEST_STATUS_LABEL[status]}</span>
          <span>&middot;</span>
          <span title={new Date(pr.updatedAt).toLocaleString()}>
            {`Updated ${getTimeAgo(pr.updatedAt)}`}
          </span>
          {isRefreshingDetails ? <Spinner label="Refreshing" compact /> : null}
        </>
      }
      actions={
        <ResourceActionsMenu label="Pull request actions">
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
          <DropdownMenuItem disabled={isRefreshingDetails} onClick={onRefresh}>
            {isRefreshingDetails ? "Refreshing..." : "Refresh"}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenInBrowser}>Open on GitHub</DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyPRLink}>Copy link</DropdownMenuItem>
          <DropdownMenuItem onClick={onCopyBranchName}>Copy branch name</DropdownMenuItem>
        </ResourceActionsMenu>
      }
      toolbar={
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-chrome">
            <Button
              type="button"
              variant="ghost"
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
              active={activeView === "files"}
              aria-pressed={activeView === "files"}
              onClick={onShowFiles}
            >
              <FilesIcon />
              {`Files ${changedFilesCount}`}
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={onComment} disabled={isClosed} variant="ghost">
              Comment
            </Button>
            <Button onClick={onMerge} disabled={!canMerge} variant="accent">
              Merge
            </Button>
          </div>
        </div>
      }
    />
  );
}
