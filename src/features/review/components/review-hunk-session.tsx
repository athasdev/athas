import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import Breadcrumb from "@/features/editor/components/toolbar/breadcrumb";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import { EmptyState } from "@/ui/empty";
import { Card } from "@/ui/card";
import { AiLoadingIcon, CheckCircleIcon, EyeIcon } from "@/ui/icons";
import { Progress } from "@/ui/progress";
import { joinPath } from "@/utils/path-helpers";
import { createReviewHunks } from "../lib/review-hunks";
import {
  requestReviewHunkInsight,
  requestReviewHunkSummaries,
} from "../services/review-intelligence";
import { useReviewStore } from "../stores/review.store";
import type {
  ReviewHunkInsight,
  ReviewHunkInsightKind,
  ReviewHunkSummary,
} from "../types/review.types";
import { ReviewHunkCard } from "./review-hunk-card";

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest("input, textarea, select, [contenteditable]")))
  );
}

function resolveSummary(
  stored: ReviewHunkSummary | string | undefined,
  fallback: ReviewHunkSummary,
): ReviewHunkSummary {
  if (!stored) return fallback;
  if (typeof stored === "string") {
    return { title: fallback.title, description: stored };
  }
  return {
    title: stored.title || fallback.title,
    description: stored.description || fallback.description,
  };
}

function isAbsoluteSourcePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("remote://") ||
    path.startsWith("wsl://") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

export function ReviewHunkSession({ multiDiff }: { multiDiff: MultiFileDiff }) {
  const reviewSession = multiDiff.reviewSession;
  const repoPath = multiDiff.repoPath;
  const activeBuffer = useBufferStore((state) =>
    getBufferById(state.buffers, state.activeBufferId),
  );
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const reviewActions = useReviewStore.use.actions();
  const sessionState = useReviewStore((state) =>
    repoPath && reviewSession
      ? state.projects[repoPath]?.hunkSessions?.[reviewSession.id]
      : undefined,
  );
  const hunks = useMemo(() => createReviewHunks(multiDiff), [multiDiff]);
  const [currentHunkId, setCurrentHunkId] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [activeInsightKind, setActiveInsightKind] = useState<ReviewHunkInsightKind | null>(null);
  const [generatingInsightKind, setGeneratingInsightKind] = useState<ReviewHunkInsightKind | null>(
    null,
  );
  const [summarizingIds, setSummarizingIds] = useState<Set<string>>(() => new Set());
  const requestedSummaryIds = useRef(new Set<string>());
  const reviewedIds = useMemo(
    () => new Set(sessionState?.reviewedHunkIds ?? []),
    [sessionState?.reviewedHunkIds],
  );
  const attentionIds = useMemo(
    () => new Set(sessionState?.attentionHunkIds ?? []),
    [sessionState?.attentionHunkIds],
  );
  const currentIndex = Math.max(
    0,
    hunks.findIndex((hunk) => hunk.id === currentHunkId),
  );
  const currentHunk = hunks[currentIndex] ?? null;
  const reviewedCount = hunks.filter((hunk) => reviewedIds.has(hunk.id)).length;
  const isComplete = hunks.length > 0 && !multiDiff.isLoading && reviewedCount === hunks.length;

  useEffect(() => {
    requestedSummaryIds.current.clear();
    setSummarizingIds(new Set());
    setCurrentHunkId(null);
    setStreak(0);
    setActiveInsightKind(null);
    setGeneratingInsightKind(null);
  }, [reviewSession?.id]);

  useEffect(() => {
    setActiveInsightKind(null);
  }, [currentHunkId]);

  useEffect(() => {
    if (hunks.length === 0) {
      setCurrentHunkId(null);
      return;
    }

    const currentExists = hunks.some((hunk) => hunk.id === currentHunkId);
    if (currentExists) return;

    const lastVisited = sessionState?.lastVisitedHunkId;
    const resumed = lastVisited ? hunks.find((hunk) => hunk.id === lastVisited) : undefined;
    const next = hunks.find((hunk) => !reviewedIds.has(hunk.id));
    setCurrentHunkId(next?.id ?? resumed?.id ?? hunks[0].id);
  }, [currentHunkId, hunks, reviewedIds, sessionState?.lastVisitedHunkId]);

  useEffect(() => {
    if (!repoPath || !reviewSession || !currentHunkId) return;
    if (sessionState?.lastVisitedHunkId === currentHunkId) return;
    reviewActions.setLastVisitedHunk(repoPath, reviewSession.id, currentHunkId);
  }, [currentHunkId, repoPath, reviewActions, reviewSession, sessionState?.lastVisitedHunkId]);

  useEffect(() => {
    if (!currentHunk) return;
    const candidates = hunks.slice(currentIndex, currentIndex + 4).filter((hunk) => {
      const storedSummary = sessionState?.summaries[hunk.id];
      return (
        (!storedSummary || typeof storedSummary === "string") &&
        !requestedSummaryIds.current.has(hunk.id)
      );
    });
    if (candidates.length === 0 || !repoPath || !reviewSession) return;

    for (const hunk of candidates) requestedSummaryIds.current.add(hunk.id);
    setSummarizingIds((current) => new Set([...current, ...candidates.map((hunk) => hunk.id)]));

    void requestReviewHunkSummaries(candidates)
      .then((summaries) => {
        if (Object.keys(summaries).length > 0) {
          reviewActions.setHunkSummaries(repoPath, reviewSession.id, summaries);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        const completedIds = new Set(candidates.map((hunk) => hunk.id));
        setSummarizingIds((current) => new Set([...current].filter((id) => !completedIds.has(id))));
      });
  }, [currentHunk, currentIndex, hunks, repoPath, reviewActions, reviewSession, sessionState]);

  const finishSession = useCallback(() => {
    if (!repoPath || !reviewSession) return;
    reviewActions.completeHunkSession(repoPath, reviewSession.id);
    if (reviewSession.sourceKind === "working-tree") {
      if (reviewSession.sourceFingerprint) {
        reviewActions.markWorkingTreeReviewed(repoPath, reviewSession.sourceFingerprint);
      }
    } else {
      reviewActions.markCommitReviewed(repoPath, multiDiff.commitHash);
    }
  }, [multiDiff.commitHash, repoPath, reviewActions, reviewSession]);

  useEffect(() => {
    if (isComplete && !sessionState?.completedAt) finishSession();
  }, [finishSession, isComplete, sessionState?.completedAt]);

  const navigate = useCallback(
    (direction: -1 | 1) => {
      const next = hunks[currentIndex + direction];
      if (next) setCurrentHunkId(next.id);
    },
    [currentIndex, hunks],
  );

  const continueReview = useCallback(() => {
    const nextUnreviewed = [...hunks.slice(currentIndex + 1), ...hunks.slice(0, currentIndex)].find(
      (hunk) => !reviewedIds.has(hunk.id),
    );
    const next = nextUnreviewed ?? hunks[currentIndex + 1] ?? hunks[0];
    if (next) setCurrentHunkId(next.id);
  }, [currentIndex, hunks, reviewedIds]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key !== "j" && key !== "k") return;
      const direction = key === "j" ? -1 : 1;
      if (!hunks[currentIndex + direction]) return;
      event.preventDefault();
      navigate(direction);
    };

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [currentIndex, hunks, navigate]);

  const markCurrentReviewed = () => {
    if (!currentHunk || !repoPath || !reviewSession) return;
    reviewActions.markHunkReviewed(repoPath, reviewSession.id, currentHunk.id);
    setStreak((current) => current + 1);

    const next = hunks
      .slice(currentIndex + 1)
      .find((hunk) => hunk.id !== currentHunk.id && !reviewedIds.has(hunk.id));
    const wrapped = hunks.find((hunk) => hunk.id !== currentHunk.id && !reviewedIds.has(hunk.id));
    const nextHunk = next ?? wrapped;
    if (nextHunk) setCurrentHunkId(nextHunk.id);
    if (!multiDiff.isLoading && reviewedCount + 1 === hunks.length) finishSession();
  };

  const openFullDiff = () => {
    if (activeBuffer?.type !== "diff") return;
    updateBufferContent(activeBuffer.id, activeBuffer.content, false, {
      ...multiDiff,
      reviewSession: undefined,
    });
  };

  const openHunkSource = () => {
    if (!currentHunk || !repoPath) return;
    const sourcePath = isAbsoluteSourcePath(currentHunk.filePath)
      ? currentHunk.filePath
      : joinPath(repoPath, currentHunk.filePath);
    void useFileSystemStore
      .getState()
      .handleFileSelect(sourcePath, false, currentHunk.newStart ?? 1, 1, undefined, false);
  };

  const requestInsight = (kind: ReviewHunkInsightKind, currentSummary: ReviewHunkSummary) => {
    if (!currentHunk || !repoPath || !reviewSession) return;
    setActiveInsightKind(kind);
    const cached = sessionState?.insights?.[currentHunk.id]?.[kind];
    if (cached) return;

    setGeneratingInsightKind(kind);
    void requestReviewHunkInsight({ hunk: currentHunk, kind, summary: currentSummary })
      .then((insight) => {
        reviewActions.setHunkInsight(repoPath, reviewSession.id, currentHunk.id, kind, insight);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "Unable to generate review help.";
        toast.error(message);
      })
      .finally(() => setGeneratingInsightKind(null));
  };

  const updateInsight = (insight: ReviewHunkInsight) => {
    if (!currentHunk || !repoPath || !reviewSession) return;
    reviewActions.setHunkInsight(repoPath, reviewSession.id, currentHunk.id, insight.kind, insight);
  };

  const resetSession = () => {
    if (!repoPath || !reviewSession) return;
    reviewActions.resetHunkSession(repoPath, reviewSession.id);
    setCurrentHunkId(hunks[0]?.id ?? null);
    setStreak(0);
  };

  if (!reviewSession || !repoPath) return null;

  if (hunks.length === 0 && !multiDiff.isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Breadcrumb
          filePathOverride={multiDiff.title ?? "Review"}
          interactive={false}
          showDefaultActions={false}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <Card variant="elevated" className="w-full max-w-md">
            <EmptyState
              icon={<CheckCircleIcon />}
              title="No text hunks"
              message="Binary, image, and metadata-only changes stay available in the full diff."
              action={{ label: "Open full diff", icon: <EyeIcon />, onClick: openFullDiff }}
            />
          </Card>
        </div>
      </div>
    );
  }

  if (isComplete) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <Breadcrumb
          filePathOverride={multiDiff.title ?? "Review"}
          interactive={false}
          showDefaultActions={false}
        />
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <Card variant="elevated" className="w-full max-w-md">
            <EmptyState
              tone="success"
              icon={<CheckCircleIcon />}
              title="Review complete"
              message={`${hunks.length} hunk${hunks.length === 1 ? "" : "s"} cleared${attentionIds.size > 0 ? ` with ${attentionIds.size} flagged for follow-up` : ""}. This checkpoint is off your queue.`}
              action={{ label: "Review again", onClick: resetSession }}
              secondaryAction={{
                label: "Open full diff",
                icon: <EyeIcon />,
                onClick: openFullDiff,
                variant: "ghost",
              }}
            />
          </Card>
        </div>
      </div>
    );
  }

  if (!currentHunk) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <Card variant="elevated" className="w-full max-w-md">
          <EmptyState
            icon={multiDiff.isLoading ? <AiLoadingIcon className="animate-spin" /> : undefined}
            message={multiDiff.isLoading ? "Indexing review hunks…" : "No reviewable hunks"}
          />
        </Card>
      </div>
    );
  }

  const currentReviewed = reviewedIds.has(currentHunk.id);
  const summary = resolveSummary(
    sessionState?.summaries[currentHunk.id],
    currentHunk.fallbackSummary,
  );
  const isSummarizing = summarizingIds.has(currentHunk.id);
  const activeInsight = activeInsightKind
    ? (sessionState?.insights?.[currentHunk.id]?.[activeInsightKind] ?? null)
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <Breadcrumb
        filePathOverride={currentHunk.filePath}
        interactive={false}
        showDefaultActions={false}
      />
      <div className="min-h-0 flex-1 overflow-auto bg-background">
        <div className="mx-auto w-full max-w-4xl p-4 md:py-6">
          <div className="mb-3 font-sans ui-text-sm">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">Review progress</span>
              <span className="shrink-0 tabular-nums text-subtle-foreground">
                {reviewedCount} of {hunks.length} reviewed
              </span>
            </div>
            <Progress
              value={(reviewedCount / Math.max(hunks.length, 1)) * 100}
              tone={reviewedCount === hunks.length ? "success" : "accent"}
            />
          </div>
          <ReviewHunkCard
            hunk={currentHunk}
            summary={summary}
            current={currentIndex + 1}
            total={hunks.length}
            isSummarizing={isSummarizing}
            isReviewed={currentReviewed}
            needsAttention={attentionIds.has(currentHunk.id)}
            streak={streak}
            activeInsightKind={activeInsightKind}
            insight={activeInsight}
            generatingInsightKind={generatingInsightKind}
            hasPrevious={currentIndex > 0}
            hasNext={currentIndex < hunks.length - 1}
            onOpenSource={openHunkSource}
            onOpenFullDiff={openFullDiff}
            onPrevious={() => navigate(-1)}
            onNext={() => navigate(1)}
            onMarkReviewed={markCurrentReviewed}
            onContinue={continueReview}
            onToggleAttention={() =>
              reviewActions.toggleHunkAttention(repoPath, reviewSession.id, currentHunk.id)
            }
            onRequestInsight={(kind) => requestInsight(kind, summary)}
            onUpdateInsight={updateInsight}
          />
        </div>
      </div>
    </div>
  );
}
