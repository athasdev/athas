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
import { memo, useState } from "react";
import { cn } from "@/utils/cn";
import type { Label, LinkedIssue, ReviewRequest, StatusCheck } from "../types";

// CI Status Indicator
interface CIStatusProps {
  checks: StatusCheck[];
}

export const CIStatusIndicator = memo(({ checks }: CIStatusProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (checks.length === 0) {
    return null;
  }

  const passedCount = checks.filter((c) => c.conclusion === "SUCCESS").length;
  const failedCount = checks.filter(
    (c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR",
  ).length;
  const pendingCount = checks.filter(
    (c) => c.status === "IN_PROGRESS" || c.status === "PENDING" || c.status === "QUEUED",
  ).length;

  const allPassed = passedCount === checks.length;
  const hasFailed = failedCount > 0;
  const hasPending = pendingCount > 0;

  const getStatusIcon = () => {
    if (hasFailed) return <XCircle size={14} className="text-red-500" />;
    if (hasPending) return <Loader2 size={14} className="animate-spin text-yellow-500" />;
    if (allPassed) return <CheckCircle2 size={14} className="text-green-500" />;
    return <CircleDot size={14} className="text-text-lighter" />;
  };

  const getStatusText = () => {
    if (hasFailed) return `${failedCount} failed`;
    if (hasPending) return `${pendingCount} pending`;
    return `${passedCount}/${checks.length} passed`;
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs hover:bg-hover"
      >
        {getStatusIcon()}
        <span
          className={cn(
            hasFailed ? "text-red-500" : hasPending ? "text-yellow-500" : "text-green-500",
          )}
        >
          {getStatusText()}
        </span>
        {isExpanded ? (
          <ChevronDown size={12} className="text-text-lighter" />
        ) : (
          <ChevronRight size={12} className="text-text-lighter" />
        )}
      </button>

      {isExpanded && (
        <div className="absolute top-full left-0 z-20 mt-1 min-w-[280px] rounded border border-border bg-primary-bg py-1">
          {checks.map((check, idx) => (
            <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
              {check.conclusion === "SUCCESS" ? (
                <CheckCircle2 size={12} className="text-green-500" />
              ) : check.conclusion === "FAILURE" || check.conclusion === "ERROR" ? (
                <XCircle size={12} className="text-red-500" />
              ) : (
                <Loader2 size={12} className="animate-spin text-yellow-500" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-text text-xs">{check.name}</p>
                <p className="truncate text-[10px] text-text-lighter">{check.workflowName}</p>
              </div>
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
      <div className={cn("flex items-center gap-1.5 rounded px-2 py-1 text-xs", status.color)}>
        <Icon size={12} />
        <span>{status.text}</span>
      </div>
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
    <div className="flex items-center gap-1.5 text-text-lighter text-xs">
      <User size={12} />
      <span>Review:</span>
      {reviewRequests.map((reviewer, idx) => (
        <span key={idx} className="text-text">
          @{reviewer.login}
          {idx < reviewRequests.length - 1 && ","}
        </span>
      ))}
    </div>
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
    <div className="flex items-center gap-1.5 text-xs">
      <Link2 size={12} className="text-text-lighter" />
      <span className="text-text-lighter">Closes</span>
      {issues.map((issue, idx) => (
        <a
          key={idx}
          href={issue.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          #{issue.number}
          {idx < issues.length - 1 && ","}
        </a>
      ))}
    </div>
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
        <span
          key={idx}
          className="rounded-full px-2 py-0.5 font-medium text-[10px]"
          style={{
            backgroundColor: `#${label.color}20`,
            color: `#${label.color}`,
            border: `1px solid #${label.color}40`,
          }}
        >
          {label.name}
        </span>
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
    <div className="flex items-center gap-1.5 text-text-lighter text-xs">
      <User size={12} />
      <span>Assigned:</span>
      {assignees.map((assignee, idx) => (
        <span key={idx} className="text-text">
          @{assignee.login}
          {idx < assignees.length - 1 && ","}
        </span>
      ))}
    </div>
  );
});

AssigneesList.displayName = "AssigneesList";
