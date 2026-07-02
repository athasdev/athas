import {
  ChatCircleIcon as MessageCircle,
  CheckCircleIcon as CheckCircle2,
  CopyIcon as Copy,
  FileCodeIcon as FileCode2,
  GitBranchIcon as GitBranch,
  GitMergeIcon as GitMerge,
  GithubLogoIcon as GithubLogo,
  GitPullRequestIcon as GitPullRequest,
  PencilSimpleIcon as Pencil,
  ArrowClockwiseIcon as RefreshCw,
  XCircleIcon as XCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import Tooltip from "@/ui/tooltip";
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
  metaItems: string[];
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
  icon?: ReactNode;
  children: ReactNode;
}

function OverviewField({ icon, children }: OverviewFieldProps) {
  return (
    <div className="ui-font ui-text-sm flex min-w-0 items-center gap-2 text-text-lighter">
      {icon ? <span className="shrink-0 text-text-lighter">{icon}</span> : null}
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
  metaItems,
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
          <span className="ui-text-sm inline-flex min-w-0 max-w-full items-center rounded-md bg-secondary-bg/80 px-1.5 py-0.5 editor-font text-text-lighter">
            <span className="min-w-0 truncate">{pr.baseRef}</span>
            <span className="shrink-0 px-1">&larr;</span>
            <span className="min-w-0 truncate">{pr.headRef}</span>
          </span>
        </>
      }
      actions={
        <>
          <Tooltip content="Refresh PR data" side="bottom">
            <Button
              onClick={onRefresh}
              disabled={isRefreshingDetails}
              variant="ghost"
              aria-label="Refresh PR data"
              compact
            >
              {isRefreshingDetails ? (
                <LoadingIndicator label="Refreshing PR" compact />
              ) : (
                <RefreshCw />
              )}
            </Button>
          </Tooltip>
          <Tooltip content="Checkout PR branch" side="bottom">
            <Button onClick={onCheckout} variant="ghost" aria-label="Checkout PR branch" compact>
              <GitBranch />
            </Button>
          </Tooltip>
          <Tooltip content="Edit pull request" side="bottom">
            <Button onClick={onEdit} variant="ghost" aria-label="Edit pull request" compact>
              <Pencil />
            </Button>
          </Tooltip>
          <Tooltip content="Add comment" side="bottom">
            <Button
              onClick={onComment}
              disabled={isClosed}
              variant="ghost"
              aria-label="Add PR comment"
              compact
            >
              <MessageCircle />
            </Button>
          </Tooltip>
          <Tooltip content="Approve pull request" side="bottom">
            <Button
              onClick={onApprove}
              disabled={isClosed}
              variant="ghost"
              aria-label="Approve pull request"
              compact
            >
              <CheckCircle2 />
            </Button>
          </Tooltip>
          <Tooltip content="Request changes" side="bottom">
            <Button
              onClick={onRequestChanges}
              disabled={isClosed}
              variant="ghost"
              aria-label="Request pull request changes"
              compact
            >
              <XCircle />
            </Button>
          </Tooltip>
          <Tooltip content="Merge pull request" side="bottom">
            <Button
              onClick={onMerge}
              disabled={!canMerge}
              variant="ghost"
              aria-label="Merge pull request"
              compact
            >
              <GitMerge />
            </Button>
          </Tooltip>
          <Tooltip content="Close pull request" side="bottom">
            <Button
              onClick={onClosePR}
              disabled={isClosed}
              variant="ghost"
              aria-label="Close pull request"
              compact
            >
              <XCircle />
            </Button>
          </Tooltip>
          <Tooltip content="Open on GitHub" side="bottom">
            <Button
              onClick={onOpenInBrowser}
              variant="ghost"
              aria-label="Open pull request in browser"
              compact
            >
              <GithubLogo />
            </Button>
          </Tooltip>
          <Tooltip content="Copy PR link" side="bottom">
            <Button onClick={onCopyPRLink} variant="ghost" aria-label="Copy PR link" compact>
              <Copy />
            </Button>
          </Tooltip>
          <Tooltip content="Copy branch name" side="bottom">
            <Button
              onClick={onCopyBranchName}
              variant="ghost"
              aria-label="Copy branch name"
              compact
            >
              <GitBranch />
            </Button>
          </Tooltip>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
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
          className="ui-text-sm h-auto min-w-0 rounded-md px-1.5 py-1 text-left"
          compact
        >
          <span className="shrink-0 text-text-lighter">
            <FileCode2 />
          </span>
          <span className="text-text-lighter">Changes</span>
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

        <OverviewField icon={<GitPullRequest />}>
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
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <MergeStatusBadge
          mergeStateStatus={pr.mergeStateStatus}
          mergeable={pr.mergeable}
          reviewDecision={pr.reviewDecision}
        />
        <AssigneesList assignees={pr.assignees ?? []} />
        <LinkedIssuesList issues={pr.linkedIssues ?? []} />
        <LabelBadges labels={pr.labels ?? []} />
      </div>

      {metaItems.length > 0 && (
        <div className="ui-font ui-text-sm flex flex-wrap items-center gap-x-2 text-text-lighter">
          {metaItems.map((item, index) => (
            <span key={`${item}-${index}`} className="inline-flex items-center gap-x-2">
              {index > 0 ? <span>&middot;</span> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      )}
    </GitHubViewerHeader>
  );
}
