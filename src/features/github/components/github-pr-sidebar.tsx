import {
  CaretRightIcon as ChevronRight,
  CheckCircleIcon as CheckCircle2,
  GitPullRequestIcon as GitPullRequest,
} from "@/ui/icons";
import { Button } from "@/ui/button";
import type { Label, PullRequestDetails } from "../types/github.types";
import { getTimeAgo } from "../utils/github-viewer-utils";
import { GitHubAvatar } from "./github-avatar";
import { GitHubAssigneePicker, GitHubLabelPicker } from "./github-metadata-pickers";
import { GitHubDetailSection, GitHubDetailSidebar } from "./github-viewer-shell";
import { CIStatusIndicator, LabelBadges, LinkedIssuesList, MergeStatusBadge } from "./pr-status";

interface GitHubPRSidebarProps {
  pr: PullRequestDetails;
  changedFilesCount: number;
  checksSummary: string;
  reviewSummary: string | null;
  commentCount: number;
  onShowFiles: () => void;
  availableLabels: Label[];
  onLabelsChange: (labels: Label[]) => void;
  onAssigneesChange: (assignees: PullRequestDetails["assignees"]) => void;
}

export function GitHubPRSidebar({
  pr,
  changedFilesCount,
  checksSummary,
  reviewSummary,
  commentCount,
  onShowFiles,
  availableLabels,
  onLabelsChange,
  onAssigneesChange,
}: GitHubPRSidebarProps) {
  const isClosed = pr.state === "closed";

  return (
    <GitHubDetailSidebar>
      <GitHubDetailSection label="Status">
        <div className="flex items-center gap-2">
          <GitPullRequest className={isClosed ? "text-destructive" : "text-success"} />
          <span className="capitalize">{pr.isDraft ? "Draft" : pr.state}</span>
        </div>
      </GitHubDetailSection>

      <GitHubDetailSection label="Merge">
        <MergeStatusBadge
          mergeStateStatus={pr.mergeStateStatus}
          mergeable={pr.mergeable}
          reviewDecision={pr.reviewDecision}
        />
      </GitHubDetailSection>

      <GitHubDetailSection label="Reviewers">
        {pr.reviewRequests.length > 0 ? (
          <div className="space-y-2">
            {pr.reviewRequests.map((reviewer) => (
              <div key={reviewer.login} className="flex min-w-0 items-center gap-2">
                <GitHubAvatar
                  login={reviewer.login}
                  avatarUrl={reviewer.avatarUrl}
                  size={32}
                  className="size-5"
                />
                <span className="min-w-0 truncate">{reviewer.login}</span>
              </div>
            ))}
            {reviewSummary ? (
              <p className="capitalize text-subtle-foreground">{reviewSummary}</p>
            ) : null}
          </div>
        ) : (
          <span className="text-subtle-foreground">{reviewSummary ?? "No reviewers"}</span>
        )}
      </GitHubDetailSection>

      <GitHubDetailSection label="Checks">
        {pr.statusChecks.length > 0 ? (
          <CIStatusIndicator checks={pr.statusChecks} />
        ) : (
          <div className="flex items-center gap-2 text-subtle-foreground">
            <CheckCircle2 />
            <span>{checksSummary}</span>
          </div>
        )}
      </GitHubDetailSection>

      <GitHubDetailSection
        label="Changes"
        action={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            onClick={onShowFiles}
            tooltip="Show changed files"
          >
            <ChevronRight />
          </Button>
        }
      >
        <div className="flex min-w-0 items-center justify-between gap-2">
          <span>{`${changedFilesCount} files changed`}</span>
          <span className="flex shrink-0 items-center gap-1.5 font-mono">
            <span className="text-git-added">+{pr.additions}</span>
            <span className="text-git-deleted">-{pr.deletions}</span>
          </span>
        </div>
      </GitHubDetailSection>

      <GitHubDetailSection label="Activity">
        <div className="space-y-1 text-subtle-foreground">
          <p>{`${pr.commits.length} commits`}</p>
          <p>{`${commentCount} comments`}</p>
          <p>{`Opened ${getTimeAgo(pr.createdAt)}`}</p>
          <p>{`Updated ${getTimeAgo(pr.updatedAt)}`}</p>
        </div>
      </GitHubDetailSection>

      <GitHubDetailSection
        label="Assignees"
        action={
          <GitHubAssigneePicker
            value={pr.assignees.map((assignee) => assignee.login)}
            onChange={(usernames) => {
              onAssigneesChange(
                usernames.map(
                  (login) => pr.assignees.find((assignee) => assignee.login === login) ?? { login },
                ),
              );
            }}
          />
        }
      >
        {pr.assignees.length > 0 ? (
          <div className="space-y-2">
            {pr.assignees.map((assignee) => (
              <div key={assignee.login} className="flex min-w-0 items-center gap-2">
                <GitHubAvatar
                  login={assignee.login}
                  avatarUrl={assignee.avatarUrl}
                  size={32}
                  className="size-5"
                />
                <span className="min-w-0 truncate">{assignee.login}</span>
              </div>
            ))}
          </div>
        ) : (
          <span className="text-subtle-foreground">No assignees</span>
        )}
      </GitHubDetailSection>

      {pr.linkedIssues.length > 0 ? (
        <GitHubDetailSection label="Linked issues">
          <LinkedIssuesList issues={pr.linkedIssues} />
        </GitHubDetailSection>
      ) : null}

      <GitHubDetailSection
        label="Labels"
        action={
          <GitHubLabelPicker
            labels={availableLabels}
            selectedNames={new Set(pr.labels.map((label) => label.name))}
            onChange={(selectedNames) => {
              onLabelsChange(availableLabels.filter((label) => selectedNames.has(label.name)));
            }}
          />
        }
      >
        {pr.labels.length > 0 ? (
          <LabelBadges labels={pr.labels} />
        ) : (
          <span className="text-subtle-foreground">No labels</span>
        )}
      </GitHubDetailSection>
    </GitHubDetailSidebar>
  );
}
