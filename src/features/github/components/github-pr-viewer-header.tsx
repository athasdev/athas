import { Button } from "@/ui/button";
import { DropdownMenuItem } from "@/ui/dropdown";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import type { PullRequestDetails } from "../types/github.types";
import { getTimeAgo } from "../utils/github-viewer-utils";
import {
  GitHubViewerActionsMenu,
  GitHubViewerHeader,
  GitHubViewerTitle,
} from "./github-viewer-shell";

interface GitHubPRViewerHeaderProps {
  pr: PullRequestDetails;
  activeView: "activity" | "files";
  changedFilesCount: number;
  additions: number;
  deletions: number;
  isRefreshingDetails: boolean;
  onRefresh: () => void;
  onCheckout: () => void;
  onOpenInBrowser: () => void;
  onCopyPRLink: () => void;
  onCopyBranchName: () => void;
  onToggleFilesView: () => void;
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
  additions,
  deletions,
  isRefreshingDetails,
  onRefresh,
  onCheckout,
  onOpenInBrowser,
  onCopyPRLink,
  onCopyBranchName,
  onToggleFilesView,
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
        <Tabs
          value={activeView}
          onValueChange={(value) => {
            if (value !== activeView) onToggleFilesView();
          }}
        >
          <TabsList variant="bare">
            <TabsTrigger value="activity" size="xs">
              Overview
            </TabsTrigger>
            <TabsTrigger value="files" size="xs">{`Files ${changedFilesCount}`}</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <Button onClick={onComment} disabled={isClosed} variant="ghost" size="xs">
            Comment
          </Button>
          <Button onClick={onMerge} disabled={!canMerge} variant="accent" size="xs">
            Merge
          </Button>
        </div>
      </div>
    </GitHubViewerHeader>
  );
}
