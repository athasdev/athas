import { CheckCircleIcon as CheckCircle2 } from "@/ui/icons";
import type { ReactNode } from "react";
import { ActionMenu } from "@/ui/action-menu";
import { Button } from "@/ui/button";
import type { PullRequestDetails } from "../types/github.types";
import {
  AssigneesList,
  CIStatusIndicator,
  LabelBadges,
  LinkedIssuesList,
  MergeStatusBadge,
} from "./pr-status";
import { GitHubViewerHeader } from "./github-viewer-shell";
import { GitHubAvatar } from "./github-avatar";

interface GitHubPRViewerHeaderProps {
  pr: PullRequestDetails;
  activeView: "activity" | "files";
  changedFilesCount: number;
  additions: number;
  deletions: number;
  checksSummary: string;
  reviewerLogins: string[];
  reviewSummary: string | null;
  isRefreshingDetails: boolean;
  onRefresh: () => void;
  onCheckout: () => void;
  onOpenInBrowser: () => void;
  onCopyPRLink: () => void;
  onCopyBranchName: () => void;
  onToggleFilesView: () => void;
  onEdit: () => void;
  onComment: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onMerge: () => void;
  onClosePR: () => void;
}

interface OverviewFieldProps {
  children: ReactNode;
}

function OverviewField({ children }: OverviewFieldProps) {
  return (
    <div className="font-sans ui-text-sm flex min-w-0 items-center gap-2 text-text-lighter">
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function GitHubPRViewerHeader({
  pr,
  activeView,
  changedFilesCount,
  additions,
  deletions,
  checksSummary,
  reviewerLogins,
  reviewSummary,
  isRefreshingDetails,
  onRefresh,
  onCheckout,
  onOpenInBrowser,
  onCopyPRLink,
  onCopyBranchName,
  onToggleFilesView,
  onEdit,
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
      title={pr.title}
      meta={
        <>
          <span>{`athas#${pr.number}`}</span>
          <span>&middot;</span>
          <span className="capitalize">{pr.isDraft ? "draft" : pr.state}</span>
          <span>&middot;</span>
          <span className="inline-flex max-w-full min-w-0 items-center gap-1 font-mono">
            <span className="min-w-0 truncate">{pr.baseRef}</span>
            <span className="shrink-0 text-text-lighter">&larr;</span>
            <span className="min-w-0 truncate">{pr.headRef}</span>
          </span>
        </>
      }
      actions={
        <>
          <Button onClick={onComment} disabled={isClosed} variant="ghost" size="xs">
            Comment
          </Button>
          <Button onClick={onMerge} disabled={!canMerge} variant="default" size="xs">
            Merge
          </Button>
          <ActionMenu
            label="Pull request actions"
            items={[
              {
                id: "refresh",
                label: isRefreshingDetails ? "Refreshing..." : "Refresh",
                disabled: isRefreshingDetails,
                onClick: onRefresh,
              },
              { id: "checkout", label: "Checkout branch", onClick: onCheckout },
              { id: "edit", label: "Edit pull request", onClick: onEdit },
              {
                id: "approve",
                label: "Approve",
                disabled: isClosed,
                onClick: onApprove,
              },
              {
                id: "request-changes",
                label: "Request changes",
                disabled: isClosed,
                onClick: onRequestChanges,
              },
              {
                id: "close",
                label: "Close pull request",
                disabled: isClosed,
                onClick: onClosePR,
              },
              {
                id: "open-browser",
                label: "Open on GitHub",
                onClick: onOpenInBrowser,
              },
              { id: "copy-link", label: "Copy link", onClick: onCopyPRLink },
              {
                id: "copy-branch",
                label: "Copy branch name",
                onClick: onCopyBranchName,
              },
            ]}
          />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <OverviewField>
          <span className="inline-flex min-w-0 items-center gap-2">
            <GitHubAvatar
              login={pr.author.login}
              avatarUrl={pr.author.avatarUrl}
              size={32}
              className="size-4"
            />
            <span className="truncate text-text-light">{pr.author.login}</span>
          </span>
        </OverviewField>

        <Button
          type="button"
          onClick={onToggleFilesView}
          variant="ghost"
          active={activeView === "files"}
          className="h-auto min-w-0 px-1.5 py-1 text-left"
          size="xs"
        >
          <span className="text-text-light">{changedFilesCount} files</span>
          <span className="text-git-added">+{additions}</span>
          <span className="text-git-deleted">-{deletions}</span>
        </Button>

        <OverviewField>
          {pr.statusChecks?.length > 0 ? (
            <CIStatusIndicator checks={pr.statusChecks} />
          ) : (
            <>
              <CheckCircle2 className="mr-1 inline text-text-lighter" />
              <span className="text-text-light">{checksSummary}</span>
            </>
          )}
        </OverviewField>

        <MergeStatusBadge
          mergeStateStatus={pr.mergeStateStatus}
          mergeable={pr.mergeable}
          reviewDecision={pr.reviewDecision}
        />

        <OverviewField>
          {pr.reviewRequests?.length > 0 ? (
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="text-text-lighter">
                {reviewSummary ? `${reviewSummary} · reviewers` : "Reviewers"}
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                {pr.reviewRequests.slice(0, 3).map((reviewer) => (
                  <GitHubAvatar
                    key={reviewer.login}
                    login={reviewer.login}
                    avatarUrl={reviewer.avatarUrl}
                    size={32}
                    className="size-4"
                  />
                ))}
                <span className="truncate text-text-light">{reviewerLogins.join(", ")}</span>
              </span>
            </span>
          ) : (
            <span className="text-text-light">
              {reviewSummary ? reviewSummary : "No reviewers"}
            </span>
          )}
        </OverviewField>
        <AssigneesList assignees={pr.assignees ?? []} />
        <LinkedIssuesList issues={pr.linkedIssues ?? []} />
        <LabelBadges labels={pr.labels ?? []} />
      </div>
    </GitHubViewerHeader>
  );
}
