import {
  CheckCircleIcon,
  CircleDotIcon,
  ClockIcon,
  GitMergeIcon,
  WarningCircleIcon,
  XCircleIcon,
} from "@/ui/icons";
import { openExternalUrl } from "@/utils/external-url";
import { memo, useMemo, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import Badge, { type BadgeTone } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import type { Label, LinkedIssue, StatusCheck } from "../types/github.types";
import {
  getGitHubLabelUrl,
  isGitHubEntityLinkForRepository,
  parseGitHubEntityLink,
} from "../utils/github-link-utils";
import type { PullRequestStatus } from "../services/github-pr-viewer-utils";

// CI Status Indicator
interface CIStatusProps {
  checks: StatusCheck[];
  /** When set, checks backed by an Actions run of this repository open inside Athas. */
  repoPath?: string;
  repositoryUrl?: string;
}

/** Failed first, then running, then passed, then skipped or neutral. */
function getCheckPriority(check: StatusCheck): number {
  if (check.conclusion === "FAILURE" || check.conclusion === "ERROR") return 0;
  if (check.status === "IN_PROGRESS" || check.status === "PENDING" || check.status === "QUEUED") {
    return 1;
  }
  if (check.conclusion === "SUCCESS") return 2;
  return 3;
}

const COLLAPSED_CHECK_COUNT = 5;

function CheckStatusIcon({ check }: { check: StatusCheck }) {
  if (check.conclusion === "SUCCESS") return <CheckCircleIcon className="text-success" />;
  if (check.conclusion === "FAILURE" || check.conclusion === "ERROR") {
    return <XCircleIcon className="text-destructive" />;
  }
  if (check.status === "IN_PROGRESS" || check.status === "PENDING" || check.status === "QUEUED") {
    return <Spinner label="Pending check" compact />;
  }
  return <CircleDotIcon className="text-subtle-foreground" />;
}

export const CIStatusIndicator = memo(({ checks, repoPath, repositoryUrl }: CIStatusProps) => {
  const [showAll, setShowAll] = useState(false);
  const { openGitHubActionBuffer } = useBufferStore.use.actions();

  const openCheck = (check: StatusCheck) => {
    if (!check.detailsUrl) return;
    const entityLink = parseGitHubEntityLink(check.detailsUrl);
    if (
      entityLink?.kind === "actionRun" &&
      repoPath &&
      isGitHubEntityLinkForRepository(entityLink, repositoryUrl)
    ) {
      openGitHubActionBuffer({
        runId: entityLink.runId,
        repoPath,
        title: check.name ?? check.workflowName ?? `Run #${entityLink.runId}`,
        url: entityLink.url,
      });
      return;
    }
    void openExternalUrl(check.detailsUrl);
  };

  const summary = useMemo(() => {
    if (checks.length === 0) return null;

    const passedCount = checks.filter((c) => c.conclusion === "SUCCESS").length;
    const failedCount = checks.filter(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
    ).length;
    const pendingCount = checks.filter(
      (c) => c.status === "IN_PROGRESS" || c.status === "PENDING" || c.status === "QUEUED",
    ).length;

    if (failedCount > 0) return { label: `${failedCount} failed`, tone: "text-destructive" };
    if (pendingCount > 0) return { label: `${pendingCount} pending`, tone: "text-warning" };
    if (passedCount === checks.length) {
      return { label: `${passedCount} checks passed`, tone: "text-success" };
    }
    return { label: `${passedCount}/${checks.length} passed`, tone: "text-subtle-foreground" };
  }, [checks]);

  const orderedChecks = useMemo(
    () => [...checks].sort((left, right) => getCheckPriority(left) - getCheckPriority(right)),
    [checks],
  );

  if (!summary) return null;

  const visibleChecks = showAll ? orderedChecks : orderedChecks.slice(0, COLLAPSED_CHECK_COUNT);
  const hiddenCount = orderedChecks.length - visibleChecks.length;

  return (
    <div className="min-w-0 space-y-1">
      <p className={cn("font-sans tabular-nums ui-text-sm", summary.tone)}>{summary.label}</p>
      <ul className="-mx-1.5 min-w-0">
        {visibleChecks.map((check, idx) => (
          <li key={`${check.name ?? "check"}-${idx}`}>
            <button
              type="button"
              onClick={() => openCheck(check)}
              disabled={!check.detailsUrl}
              title={
                check.workflowName ? `${check.workflowName} / ${check.name ?? "Check"}` : undefined
              }
              className="flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left font-sans ui-text-sm text-muted-foreground outline-none transition-colors duration-fast hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:hover:bg-transparent [&_svg]:size-3.5 [&_svg]:shrink-0"
            >
              <CheckStatusIcon check={check} />
              <span className="min-w-0 flex-1 truncate">{check.name ?? "Check"}</span>
            </button>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 || showAll ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll ? "Show fewer" : `Show ${hiddenCount} more`}
        </Button>
      ) : null}
    </div>
  );
});

CIStatusIndicator.displayName = "CIStatusIndicator";

// Merge Status Badge
interface MergeStatusProps {
  status: PullRequestStatus;
  mergeStateStatus: string | null;
  mergeable: string | null;
  reviewDecision: string | null;
}

interface MergeStatusInfo {
  text: string;
  variant: BadgeTone;
  icon: typeof WarningCircleIcon;
  /** The pull request can be merged right now. */
  ready: boolean;
}

export function getMergeStatusInfo({
  status,
  mergeStateStatus,
  mergeable,
  reviewDecision,
}: MergeStatusProps): MergeStatusInfo {
  const blocked = (text: string, variant: BadgeTone, icon: typeof WarningCircleIcon) => ({
    text,
    variant,
    icon,
    ready: false,
  });
  if (status === "merged") return blocked("Merged", "merged", GitMergeIcon);
  if (status === "closed") return blocked("Closed without merging", "neutral", XCircleIcon);

  const mergeState = (mergeStateStatus ?? "").toLowerCase();
  const hasConflicts =
    mergeable === "false" || mergeable === "CONFLICTING" || mergeState === "dirty";
  if (hasConflicts) return blocked("Has conflicts", "danger", WarningCircleIcon);
  if (status === "draft") return blocked("Draft", "neutral", CircleDotIcon);

  switch (mergeState) {
    case "blocked":
      if (reviewDecision === "CHANGES_REQUESTED") {
        return blocked("Changes requested", "danger", WarningCircleIcon);
      }
      if (!reviewDecision || reviewDecision === "REVIEW_REQUIRED") {
        return blocked("Review required", "warning", WarningCircleIcon);
      }
      return blocked("Blocked by checks", "warning", WarningCircleIcon);
    case "behind":
      return blocked("Behind base branch", "warning", WarningCircleIcon);
    case "unstable":
      return { text: "Merge", variant: "warning", icon: GitMergeIcon, ready: true };
    case "clean":
    case "has_hooks":
      return { text: "Merge", variant: "success", icon: GitMergeIcon, ready: true };
    default:
      return blocked("Checking mergeability", "neutral", ClockIcon);
  }
}

// Linked Issues
interface LinkedIssuesProps {
  issues: LinkedIssue[];
  /** When set, issues of this repository open inside Athas instead of the browser. */
  repoPath?: string;
  repositoryUrl?: string;
}

export const LinkedIssuesList = memo(({ issues, repoPath, repositoryUrl }: LinkedIssuesProps) => {
  const { openGitHubIssueBuffer } = useBufferStore.use.actions();
  if (issues.length === 0) return null;

  const openIssue = (issue: LinkedIssue) => {
    const entityLink = parseGitHubEntityLink(issue.url);
    if (
      entityLink?.kind === "issue" &&
      repoPath &&
      isGitHubEntityLinkForRepository(entityLink, repositoryUrl)
    ) {
      openGitHubIssueBuffer({
        issueNumber: issue.number,
        repoPath,
        title: `Issue #${issue.number}`,
        url: issue.url,
      });
      return;
    }
    void openExternalUrl(issue.url);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 font-sans ui-text-sm">
      {issues.map((issue, idx) => (
        <button
          key={idx}
          type="button"
          onClick={() => openIssue(issue)}
          className="inline-flex items-center gap-1 rounded-chrome text-primary tabular-nums hover:underline focus-visible:underline focus-visible:outline-none"
          aria-label={`Open issue #${issue.number}`}
        >
          <CircleDotIcon className="size-3.5 text-subtle-foreground" />#{issue.number}
        </button>
      ))}
    </span>
  );
});

LinkedIssuesList.displayName = "LinkedIssuesList";

// Labels
interface LabelBadgesProps {
  labels: Label[];
  /** When set, clicking a label opens the matching filtered list on GitHub. */
  repositoryUrl?: string;
  kind?: "issues" | "pulls";
}

export const LabelBadges = memo(({ labels, repositoryUrl, kind = "issues" }: LabelBadgesProps) => {
  if (labels.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map((label, idx) => {
        if (!repositoryUrl) {
          return (
            <Badge key={idx} labelColor={label.color}>
              {label.name}
            </Badge>
          );
        }
        return (
          <button
            key={idx}
            type="button"
            title={`Open ${kind === "pulls" ? "pull requests" : "issues"} labelled ${label.name} on GitHub`}
            onClick={() => void openExternalUrl(getGitHubLabelUrl(repositoryUrl, label.name, kind))}
            className="rounded-full outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-focus"
          >
            <Badge labelColor={label.color}>{label.name}</Badge>
          </button>
        );
      })}
    </div>
  );
});

LabelBadges.displayName = "LabelBadges";
