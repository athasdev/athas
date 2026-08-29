import { useMemo } from "react";
import { toast } from "sonner";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { openWorkingTreeDiffBuffer } from "@/features/git/utils/open-working-tree-diff-buffer";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { EmptyState } from "@/ui/empty";
import {
  ArrowClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  ListChecksIcon,
  ShieldWarningIcon,
} from "@/ui/icons";
import { Progress } from "@/ui/progress";
import {
  SidebarComposerBody,
  SidebarIconButton,
  SidebarScrollArea,
  SidebarSection,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";
import { useReviewChangeSets } from "../hooks/use-review-change-sets";
import { useReviewStore } from "../stores/review.store";
import type { ReviewChangeSet, ReviewRiskLevel, ReviewViewMode } from "../types/review.types";
import { ReviewAccessGate } from "./review-access-gate";
import { ReviewChangeCard } from "./review-change-card";

const MODE_ITEMS: Array<{
  id: ReviewViewMode;
  label: string;
  icon: typeof ListChecksIcon;
}> = [
  { id: "queue", label: "Queue", icon: ListChecksIcon },
  { id: "timeline", label: "Timeline", icon: ClockCounterClockwiseIcon },
  { id: "risk", label: "Risk", icon: ShieldWarningIcon },
];

const RISK_SECTIONS: Array<{ id: ReviewRiskLevel; title: string }> = [
  { id: "high", title: "High attention" },
  { id: "medium", title: "Review closely" },
  { id: "low", title: "Focused changes" },
];

function ReviewSidebarContent() {
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const {
    activeRepoPath,
    gitStatus,
    commits,
    projectState,
    fingerprint,
    queueChangeSets,
    timelineChangeSets,
    isLoading,
    refresh,
  } = useReviewChangeSets(rootFolderPath);
  const reviewActions = useReviewStore.use.actions();
  const reviewedInSession =
    projectState.reviewedCommitHashes.length +
    (fingerprint && projectState.reviewedWorkingTreeFingerprint === fingerprint ? 1 : 0);
  const reviewScopeSize = reviewedInSession + queueChangeSets.length;
  const progress = reviewScopeSize === 0 ? 100 : (reviewedInSession / reviewScopeSize) * 100;

  const groupedByRisk = useMemo(
    () =>
      Object.fromEntries(
        RISK_SECTIONS.map(({ id }) => [
          id,
          queueChangeSets.filter((changeSet) => changeSet.risk === id),
        ]),
      ) as Record<ReviewRiskLevel, ReviewChangeSet[]>,
    [queueChangeSets],
  );

  const openChangeSet = async (changeSet: ReviewChangeSet) => {
    if (!activeRepoPath) return;
    if (changeSet.kind === "working-tree") {
      const bufferId = openWorkingTreeDiffBuffer({
        repoPath: activeRepoPath,
        files: gitStatus?.files ?? [],
        reviewSession: {
          id: changeSet.id,
          sourceKind: "working-tree",
          sourceFingerprint: fingerprint ?? undefined,
        },
      });
      if (!bufferId)
        toast.info("Only untracked files are available. Open them from Source Control.");
      return;
    }

    const commit = changeSet.commit;
    if (!commit) return;
    const bufferId = await openCommitDiffBuffer({
      repoPath: activeRepoPath,
      commitHash: commit.hash,
      message: commit.message,
      description: commit.description,
      author: commit.author,
      email: commit.email,
      date: commit.date,
      reviewSession: {
        id: changeSet.id,
        sourceKind: "commit",
      },
    });
    if (!bufferId) toast.info("This commit has no reviewable diff.");
  };

  const markReviewed = (changeSet: ReviewChangeSet) => {
    if (!activeRepoPath) return;
    if (changeSet.kind === "working-tree") {
      if (fingerprint) reviewActions.markWorkingTreeReviewed(activeRepoPath, fingerprint);
    } else if (changeSet.commit) {
      reviewActions.markCommitReviewed(activeRepoPath, changeSet.commit.hash);
    }
  };

  const markAllReviewed = () => {
    if (!activeRepoPath) return;
    reviewActions.markAllReviewed(activeRepoPath, commits[0]?.hash ?? null, fingerprint);
  };

  const renderCards = (changeSets: ReviewChangeSet[], showReviewed = false) => (
    <div className="flex flex-col gap-chrome-tight">
      {changeSets.map((changeSet) => (
        <ReviewChangeCard
          key={changeSet.id}
          changeSet={changeSet}
          onOpen={() => void openChangeSet(changeSet)}
          onMarkReviewed={changeSet.reviewed ? undefined : () => markReviewed(changeSet)}
          showReviewed={showReviewed}
        />
      ))}
    </div>
  );

  if (!activeRepoPath && !isLoading) {
    return (
      <SidebarWorkspace title="Review">
        <EmptyState
          layout="sidebar"
          icon={<ListChecksIcon />}
          title="No Git repository"
          message="Open a Git-backed project to start collecting review checkpoints."
        />
      </SidebarWorkspace>
    );
  }

  return (
    <SidebarWorkspace
      title="Review"
      actions={
        <SidebarIconButton
          tooltip="Refresh review queue"
          tooltipSide="bottom"
          disabled={!activeRepoPath || isLoading}
          onClick={() => void refresh()}
        >
          <ArrowClockwiseIcon />
        </SidebarIconButton>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col px-chrome-inline pb-2">
        <SidebarComposerBody className="mb-2 p-2">
          <div className="flex min-w-0 items-center gap-chrome font-sans ui-text-sm">
            <ListChecksIcon className="shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {queueChangeSets.length > 0 ? `${queueChangeSets.length} pending` : "Caught up"}
            </span>
            <span
              className="shrink-0 tabular-nums text-subtle-foreground"
              aria-label={`${reviewedInSession} of ${reviewScopeSize} checkpoints reviewed`}
            >
              {reviewedInSession}/{reviewScopeSize}
            </span>
            {queueChangeSets.length > 1 ? (
              <SidebarIconButton
                tooltip="Mark all reviewed"
                tooltipSide="bottom"
                onClick={markAllReviewed}
              >
                <CheckIcon />
              </SidebarIconButton>
            ) : null}
          </div>
          <Progress
            value={progress}
            tone={queueChangeSets.length > 0 ? "accent" : "success"}
            className="mt-2"
          />
        </SidebarComposerBody>

        <Tabs
          value={projectState.viewMode}
          onValueChange={(value) => {
            if (activeRepoPath) reviewActions.setViewMode(activeRepoPath, value as ReviewViewMode);
          }}
          className="min-h-0 flex-1"
        >
          <TabsList variant="bare" className="grid w-full grid-cols-3" aria-label="Review view">
            {MODE_ITEMS.map(({ id, label, icon: Icon }) => (
              <Tooltip key={id} content={label} side="bottom" triggerClassName="w-full">
                <TabsTrigger value={id} aria-label={`${label} review view`} className="w-full">
                  <Icon />
                  <span className="sr-only">{label}</span>
                </TabsTrigger>
              </Tooltip>
            ))}
          </TabsList>

          <SidebarScrollArea className="mt-2 min-h-0 flex-1">
            {isLoading && timelineChangeSets.length === 0 ? (
              <EmptyState
                layout="sidebar"
                message={<Spinner label="Collecting review checkpoints" showLabel compact />}
              />
            ) : projectState.viewMode === "queue" ? (
              queueChangeSets.length > 0 ? (
                renderCards(queueChangeSets)
              ) : (
                <EmptyState
                  layout="sidebar"
                  tone="success"
                  icon={<CheckCircleIcon />}
                  title="You're caught up"
                  message="New working-tree changes and commits will appear here automatically."
                  action={{
                    label: "Refresh",
                    icon: <ArrowClockwiseIcon />,
                    onClick: () => void refresh(),
                  }}
                />
              )
            ) : projectState.viewMode === "timeline" ? (
              timelineChangeSets.length > 0 ? (
                renderCards(timelineChangeSets, true)
              ) : (
                <EmptyState layout="sidebar" message="No recent checkpoints" />
              )
            ) : queueChangeSets.length > 0 ? (
              <div className="flex flex-col gap-2">
                {RISK_SECTIONS.map(({ id, title }) =>
                  groupedByRisk[id].length > 0 ? (
                    <SidebarSection key={id} title={title} count={groupedByRisk[id].length}>
                      {renderCards(groupedByRisk[id])}
                    </SidebarSection>
                  ) : null,
                )}
              </div>
            ) : (
              <EmptyState
                layout="sidebar"
                tone="success"
                icon={<CheckCircleIcon />}
                title="No attention needed"
                message="The review queue is clear."
              />
            )}
          </SidebarScrollArea>
        </Tabs>
      </div>
    </SidebarWorkspace>
  );
}

export function ReviewSidebar() {
  const { hasIntelligence } = useProFeature();
  return hasIntelligence ? <ReviewSidebarContent /> : <ReviewAccessGate />;
}
