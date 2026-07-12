import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle2,
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  DotOutlineIcon as CircleDot,
  GitMergeIcon as GitMerge,
  LinkSimpleIcon as Link2,
  UserIcon as User,
  XCircleIcon as XCircle,
} from "@/ui/icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { memo, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { LoadingIndicator } from "@/ui/loading";
import { cn } from "@/utils/cn";
import type { Label, LinkedIssue, ReviewRequest, StatusCheck } from "../types/github.types";

// CI Status Indicator
interface CIStatusProps {
  checks: StatusCheck[];
}

type BadgeVariant = ComponentProps<typeof Badge>["variant"];

function getCheckBadgeVariant(check: StatusCheck): BadgeVariant {
  if (check.conclusion === "SUCCESS") return "success";
  if (check.conclusion === "FAILURE" || check.conclusion === "ERROR") {
    return "error";
  }
  if (check.status === "IN_PROGRESS" || check.status === "PENDING" || check.status === "QUEUED") {
    return "warning";
  }
  return "muted";
}

export const CIStatusIndicator = memo(({ checks }: CIStatusProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const summary = useMemo(() => {
    if (checks.length === 0) return null;

    const passedCount = checks.filter((c) => c.conclusion === "SUCCESS").length;
    const failedCount = checks.filter(
      (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
    ).length;
    const pendingCount = checks.filter(
      (c) => c.status === "IN_PROGRESS" || c.status === "PENDING" || c.status === "QUEUED",
    ).length;

    if (failedCount > 0) {
      return {
        icon: <XCircle className="text-error" />,
        label: `${failedCount} failed`,
        tone: "text-error",
      };
    }

    if (pendingCount > 0) {
      return {
        icon: <LoadingIndicator label="Pending checks" compact />,
        label: `${pendingCount} pending`,
        tone: "text-warning",
      };
    }

    if (passedCount === checks.length) {
      return {
        icon: <CheckCircle2 className="text-success" />,
        label: `${passedCount} checks passed`,
        tone: "text-success",
      };
    }

    return {
      icon: <CircleDot className="text-text-lighter" />,
      label: `${passedCount}/${checks.length} passed`,
      tone: "text-text-lighter",
    };
  }, [checks]);

  if (!summary) return null;

  return (
    <div className="relative inline-flex shrink-0">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => setIsExpanded(!isExpanded)}
        className="ui-text-sm h-auto min-w-0 px-1.5 py-1 text-left"
        aria-expanded={isExpanded}
      >
        {summary.icon}
        <span className={cn("font-sans ui-text-sm", summary.tone)}>{summary.label}</span>
        {isExpanded ? (
          <ChevronDown className="text-text-lighter" />
        ) : (
          <ChevronRight className="text-text-lighter" />
        )}
      </Button>

      {isExpanded && (
        <div className="absolute top-full left-0 z-50 mt-1.5 min-w-[320px] rounded-xl border border-border/70 bg-secondary-bg/95 p-1.5 shadow-[var(--shadow-popover)] backdrop-blur-sm">
          {checks.map((check, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                if (check.detailsUrl) {
                  void openUrl(check.detailsUrl);
                }
              }}
              disabled={!check.detailsUrl}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-text transition-colors hover:bg-hover disabled:cursor-default disabled:hover:bg-transparent"
            >
              {check.conclusion === "SUCCESS" ? (
                <CheckCircle2 className="text-success" />
              ) : check.conclusion === "FAILURE" || check.conclusion === "ERROR" ? (
                <XCircle className="text-error" />
              ) : (
                <LoadingIndicator label="Pending check" compact />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-sans ui-text-sm truncate text-text">{check.name ?? "Check"}</p>
                {check.workflowName && (
                  <p className="font-sans ui-text-sm truncate text-text-lighter">
                    {check.workflowName}
                  </p>
                )}
              </div>
              <Badge variant={getCheckBadgeVariant(check)} size="compact" className="capitalize">
                {(check.conclusion ?? check.status ?? "pending").toLowerCase()}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

CIStatusIndicator.displayName = "CIStatusIndicator";

// Merge Status Badge
interface MergeStatusProps {
  mergeStateStatus: string | null;
  mergeable: string | null;
  reviewDecision: string | null;
}

export const MergeStatusBadge = memo(
  ({ mergeStateStatus, mergeable, reviewDecision }: MergeStatusProps) => {
    const getStatusInfo = (): {
      text: string;
      variant: BadgeVariant;
      icon: typeof AlertCircle;
    } | null => {
      if (mergeable === "CONFLICTING") {
        return { text: "Has conflicts", variant: "error", icon: AlertCircle };
      }
      if (mergeStateStatus === "BLOCKED") {
        if (reviewDecision === "CHANGES_REQUESTED") {
          return {
            text: "Changes requested",
            variant: "error",
            icon: AlertCircle,
          };
        }
        if (!reviewDecision || reviewDecision === "REVIEW_REQUIRED") {
          return {
            text: "Review required",
            variant: "warning",
            icon: AlertCircle,
          };
        }
        return { text: "Blocked", variant: "warning", icon: AlertCircle };
      }
      if (
        mergeStateStatus === "CLEAN" ||
        mergeStateStatus === "HAS_HOOKS" ||
        mergeStateStatus === "UNSTABLE"
      ) {
        return { text: "Ready to merge", variant: "success", icon: GitMerge };
      }
      if (mergeStateStatus === "BEHIND") {
        return {
          text: "Behind base",
          variant: "warning",
          icon: AlertCircle,
        };
      }
      return null;
    };

    const status = getStatusInfo();
    if (!status) return null;

    const Icon = status.icon;

    return (
      <Badge variant={status.variant} size="compact" className="gap-1">
        <Icon />
        <span>{status.text}</span>
      </Badge>
    );
  },
);

MergeStatusBadge.displayName = "MergeStatusBadge";

// Review Requests List
interface ReviewRequestsProps {
  reviewRequests: ReviewRequest[];
}

export const ReviewRequestsList = memo(({ reviewRequests }: ReviewRequestsProps) => {
  if (reviewRequests.length === 0) return null;

  return (
    <span className="font-sans ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
      <User />
      <span>Reviewers</span>
      <span className="text-text">
        {reviewRequests.map((reviewer) => `@${reviewer.login}`).join(", ")}
      </span>
    </span>
  );
});

ReviewRequestsList.displayName = "ReviewRequestsList";

// Linked Issues
interface LinkedIssuesProps {
  issues: LinkedIssue[];
}

export const LinkedIssuesList = memo(({ issues }: LinkedIssuesProps) => {
  if (issues.length === 0) return null;

  return (
    <span className="font-sans ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
      <Link2 className="text-text-lighter" />
      <span>Linked</span>
      <span className="inline-flex items-center gap-1">
        {issues.map((issue, idx) => (
          <a
            key={idx}
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans ui-text-sm text-accent hover:underline"
          >
            #{issue.number}
            {idx < issues.length - 1 && ","}
          </a>
        ))}
      </span>
    </span>
  );
});

LinkedIssuesList.displayName = "LinkedIssuesList";

// Labels
interface LabelBadgesProps {
  labels: Label[];
}

export const LabelBadges = memo(({ labels }: LabelBadgesProps) => {
  if (labels.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {labels.map((label, idx) => (
        <Badge
          key={idx}
          size="compact"
          className="border"
          style={{
            backgroundColor: `#${label.color}20`,
            color: `#${label.color}`,
            border: `1px solid #${label.color}40`,
          }}
        >
          {label.name}
        </Badge>
      ))}
    </div>
  );
});

LabelBadges.displayName = "LabelBadges";

// Assignees
interface AssigneesProps {
  assignees: { login: string }[];
}

export const AssigneesList = memo(({ assignees }: AssigneesProps) => {
  if (assignees.length === 0) return null;

  return (
    <span className="font-sans ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
      <User />
      <span>Assigned</span>
      <span className="text-text">
        {assignees.map((assignee) => `@${assignee.login}`).join(", ")}
      </span>
    </span>
  );
});

AssigneesList.displayName = "AssigneesList";
