import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  GitMerge,
  Link2,
  Loader2,
  User,
  XCircle,
} from "lucide-react";
import { memo, useMemo, useState } from "react";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type { Label, LinkedIssue, ReviewRequest, StatusCheck } from "../types/github";

// CI Status Indicator
interface CIStatusProps {
  checks: StatusCheck[];
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
        icon: <XCircle className="text-red-500" />,
        label: `${failedCount} failed`,
        tone: "text-red-500",
        badgeClassName: "border-red-500/20 bg-red-500/10 text-red-500",
      };
    }

    if (pendingCount > 0) {
      return {
        icon: <Loader2 className="animate-spin text-yellow-500" />,
        label: `${pendingCount} pending`,
        tone: "text-yellow-500",
        badgeClassName: "border-yellow-500/20 bg-yellow-500/10 text-yellow-500",
      };
    }

    if (passedCount === checks.length) {
      return {
        icon: <CheckCircle2 className="text-green-500" />,
        label: `${passedCount} checks passed`,
        tone: "text-green-500",
        badgeClassName: "border-green-500/20 bg-green-500/10 text-green-500",
      };
    }

    return {
      icon: <CircleDot className="text-text-lighter" />,
      label: `${passedCount}/${checks.length} passed`,
      tone: "text-text-lighter",
      badgeClassName: "",
    };
  }, [checks]);

  if (!summary) return null;

  return (
    <div className="relative inline-flex shrink-0">
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => setIsExpanded(!isExpanded)}
        className="border-border/70 bg-primary-bg/70 text-text"
      >
        {summary.icon}
        <span className={cn("ui-font ui-text-sm", summary.tone)}>{summary.label}</span>
        {isExpanded ? (
          <ChevronDown className="text-text-lighter" />
        ) : (
          <ChevronRight className="text-text-lighter" />
        )}
      </Button>

      {isExpanded && (
        <div className="absolute top-full left-0 z-20 mt-2 min-w-[320px] rounded-2xl border border-border/70 bg-secondary-bg/95 p-2 shadow-xl backdrop-blur-sm">
          {checks.map((check, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-hover/60"
            >
              {check.conclusion === "SUCCESS" ? (
                <CheckCircle2 className="text-green-500" />
              ) : check.conclusion === "FAILURE" || check.conclusion === "ERROR" ? (
                <XCircle className="text-red-500" />
              ) : (
                <Loader2 className="animate-spin text-yellow-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="ui-font ui-text-sm truncate text-text">{check.name ?? "Check"}</p>
                {check.workflowName && (
                  <p className="ui-font ui-text-sm truncate text-text-lighter">
                    {check.workflowName}
                  </p>
                )}
              </div>
              <Badge
                variant="muted"
                shape="pill"
                size="compact"
                className={cn("capitalize", summary.badgeClassName)}
              >
                {(check.conclusion ?? check.status ?? "pending").toLowerCase()}
              </Badge>
            </div>
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
    const getStatusInfo = () => {
      if (mergeable === "CONFLICTING") {
        return { text: "Has conflicts", color: "text-red-500 bg-red-500/10", icon: AlertCircle };
      }
      if (mergeStateStatus === "BLOCKED") {
        if (reviewDecision === "CHANGES_REQUESTED") {
          return {
            text: "Changes requested",
            color: "text-red-500 bg-red-500/10",
            icon: AlertCircle,
          };
        }
        if (!reviewDecision || reviewDecision === "REVIEW_REQUIRED") {
          return {
            text: "Review required",
            color: "text-yellow-500 bg-yellow-500/10",
            icon: AlertCircle,
          };
        }
        return { text: "Blocked", color: "text-yellow-500 bg-yellow-500/10", icon: AlertCircle };
      }
      if (
        mergeStateStatus === "CLEAN" ||
        mergeStateStatus === "HAS_HOOKS" ||
        mergeStateStatus === "UNSTABLE"
      ) {
        return { text: "Ready to merge", color: "text-green-500 bg-green-500/10", icon: GitMerge };
      }
      if (mergeStateStatus === "BEHIND") {
        return {
          text: "Behind base",
          color: "text-yellow-500 bg-yellow-500/10",
          icon: AlertCircle,
        };
      }
      return null;
    };

    const status = getStatusInfo();
    if (!status) return null;

    const Icon = status.icon;

    return (
      <Badge shape="pill" size="compact" className={cn("gap-1", status.color)}>
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
    <span className="ui-font ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
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
    <span className="ui-font ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
      <Link2 className="text-text-lighter" />
      <span>Linked</span>
      <span className="inline-flex items-center gap-1">
        {issues.map((issue, idx) => (
          <a
            key={idx}
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ui-font ui-text-sm text-accent hover:underline"
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
          shape="pill"
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
    <span className="ui-font ui-text-sm inline-flex shrink-0 items-center gap-1 text-text-lighter">
      <User />
      <span>Assigned</span>
      <span className="text-text">
        {assignees.map((assignee) => `@${assignee.login}`).join(", ")}
      </span>
    </span>
  );
});

AssigneesList.displayName = "AssigneesList";
