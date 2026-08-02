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
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import type { Label, LinkedIssue, StatusCheck } from "../types/github.types";

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
        icon: <XCircle className="text-destructive" />,
        label: `${failedCount} failed`,
        tone: "text-destructive",
      };
    }

    if (pendingCount > 0) {
      return {
        icon: <Spinner label="Pending checks" compact />,
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
      icon: <CircleDot className="text-subtle-foreground" />,
      label: `${passedCount}/${checks.length} passed`,
      tone: "text-subtle-foreground",
    };
  }, [checks]);

  if (!summary) return null;

  return (
    <Popover open={isExpanded} onOpenChange={setIsExpanded}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="h-auto min-w-0 px-1.5 py-1 text-left ui-text-sm"
          />
        }
      >
        {summary.icon}
        <span className={cn("font-sans ui-text-sm", summary.tone)}>{summary.label}</span>
        {isExpanded ? (
          <ChevronDown className="text-subtle-foreground" />
        ) : (
          <ChevronRight className="text-subtle-foreground" />
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="min-w-[320px] p-1.5">
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
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
          >
            {check.conclusion === "SUCCESS" ? (
              <CheckCircle2 className="text-success" />
            ) : check.conclusion === "FAILURE" || check.conclusion === "ERROR" ? (
              <XCircle className="text-destructive" />
            ) : (
              <Spinner label="Pending check" compact />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans ui-text-sm text-foreground">
                {check.name ?? "Check"}
              </p>
              {check.workflowName && (
                <p className="truncate font-sans ui-text-sm text-subtle-foreground">
                  {check.workflowName}
                </p>
              )}
            </div>
            <Badge variant={getCheckBadgeVariant(check)} size="compact" className="capitalize">
              {(check.conclusion ?? check.status ?? "pending").toLowerCase()}
            </Badge>
          </button>
        ))}
      </PopoverContent>
    </Popover>
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

// Linked Issues
interface LinkedIssuesProps {
  issues: LinkedIssue[];
}

export const LinkedIssuesList = memo(({ issues }: LinkedIssuesProps) => {
  if (issues.length === 0) return null;

  return (
    <span className="font-sans ui-text-sm inline-flex shrink-0 items-center gap-1 text-subtle-foreground">
      <Link2 className="text-subtle-foreground" />
      <span>Linked</span>
      <span className="inline-flex items-center gap-1">
        {issues.map((issue, idx) => (
          <a
            key={idx}
            href={issue.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-sans ui-text-sm text-primary hover:underline"
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
          style={{
            backgroundColor: `#${label.color}20`,
            color: `#${label.color}`,
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
    <span className="font-sans ui-text-sm inline-flex shrink-0 items-center gap-1 text-subtle-foreground">
      <User />
      <span>Assigned</span>
      <span className="text-foreground">
        {assignees.map((assignee) => `@${assignee.login}`).join(", ")}
      </span>
    </span>
  );
});

AssigneesList.displayName = "AssigneesList";
