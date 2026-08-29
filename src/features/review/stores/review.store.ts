import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import { EMPTY_PROJECT_REVIEW_STATE } from "../lib/review-model";
import type {
  ProjectReviewState,
  ReviewHunkInsight,
  ReviewHunkInsightKind,
  ReviewHunkSummary,
  ReviewViewMode,
} from "../types/review.types";

const REVIEW_SESSION_LIMIT = 20;

function getReviewSession(project: ProjectReviewState, sessionId: string) {
  return (
    project.hunkSessions?.[sessionId] ?? {
      reviewedHunkIds: [],
      summaries: {},
      lastVisitedHunkId: null,
      completedAt: null,
      updatedAt: new Date().toISOString(),
    }
  );
}

function updateHunkSession(
  project: ProjectReviewState,
  sessionId: string,
  update: (current: ReturnType<typeof getReviewSession>) => ReturnType<typeof getReviewSession>,
) {
  const nextSession = update(getReviewSession(project, sessionId));
  const hunkSessions = Object.fromEntries(
    Object.entries({
      ...project.hunkSessions,
      [sessionId]: nextSession,
    })
      .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, REVIEW_SESSION_LIMIT),
  );

  return { ...project, hunkSessions };
}

interface ReviewState {
  projects: Record<string, ProjectReviewState>;
  actions: {
    establishBaseline: (repoPath: string, commitHash: string) => void;
    setViewMode: (repoPath: string, viewMode: ReviewViewMode) => void;
    markCommitReviewed: (repoPath: string, commitHash: string) => void;
    markWorkingTreeReviewed: (repoPath: string, fingerprint: string) => void;
    markAllReviewed: (
      repoPath: string,
      headHash: string | null,
      fingerprint: string | null,
    ) => void;
    setHunkSummaries: (
      repoPath: string,
      sessionId: string,
      summaries: Record<string, ReviewHunkSummary>,
    ) => void;
    setLastVisitedHunk: (repoPath: string, sessionId: string, hunkId: string) => void;
    setHunkInsight: (
      repoPath: string,
      sessionId: string,
      hunkId: string,
      kind: ReviewHunkInsightKind,
      insight: ReviewHunkInsight,
    ) => void;
    toggleHunkAttention: (repoPath: string, sessionId: string, hunkId: string) => void;
    markHunkReviewed: (repoPath: string, sessionId: string, hunkId: string) => void;
    completeHunkSession: (repoPath: string, sessionId: string) => void;
    resetHunkSession: (repoPath: string, sessionId: string) => void;
  };
}

function updateProject(
  projects: Record<string, ProjectReviewState>,
  repoPath: string,
  update: (current: ProjectReviewState) => ProjectReviewState,
) {
  return {
    ...projects,
    [repoPath]: update(projects[repoPath] ?? EMPTY_PROJECT_REVIEW_STATE),
  };
}

const useReviewStoreBase = create<ReviewState>()(
  persist(
    (set) => ({
      projects: {},
      actions: {
        establishBaseline: (repoPath, commitHash) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              project.reviewedThroughHash
                ? project
                : { ...project, reviewedThroughHash: commitHash },
            ),
          })),
        setViewMode: (repoPath, viewMode) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) => ({
              ...project,
              viewMode,
            })),
          })),
        markCommitReviewed: (repoPath, commitHash) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) => ({
              ...project,
              reviewedCommitHashes: [
                commitHash,
                ...project.reviewedCommitHashes.filter((hash) => hash !== commitHash),
              ].slice(0, 200),
              lastReviewedAt: new Date().toISOString(),
            })),
          })),
        markWorkingTreeReviewed: (repoPath, fingerprint) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) => ({
              ...project,
              reviewedWorkingTreeFingerprint: fingerprint,
              lastReviewedAt: new Date().toISOString(),
            })),
          })),
        markAllReviewed: (repoPath, headHash, fingerprint) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) => ({
              ...project,
              reviewedThroughHash: headHash ?? project.reviewedThroughHash,
              reviewedCommitHashes: [],
              reviewedWorkingTreeFingerprint: fingerprint,
              lastReviewedAt: new Date().toISOString(),
            })),
          })),
        setHunkSummaries: (repoPath, sessionId, summaries) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                summaries: { ...session.summaries, ...summaries },
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
        setLastVisitedHunk: (repoPath, sessionId, hunkId) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                lastVisitedHunkId: hunkId,
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
        setHunkInsight: (repoPath, sessionId, hunkId, kind, insight) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                insights: {
                  ...session.insights,
                  [hunkId]: {
                    ...session.insights?.[hunkId],
                    [kind]: insight,
                  },
                },
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
        toggleHunkAttention: (repoPath, sessionId, hunkId) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => {
                const attentionHunkIds = session.attentionHunkIds ?? [];
                return {
                  ...session,
                  attentionHunkIds: attentionHunkIds.includes(hunkId)
                    ? attentionHunkIds.filter((id) => id !== hunkId)
                    : [...attentionHunkIds, hunkId],
                  updatedAt: new Date().toISOString(),
                };
              }),
            ),
          })),
        markHunkReviewed: (repoPath, sessionId, hunkId) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                reviewedHunkIds: session.reviewedHunkIds.includes(hunkId)
                  ? session.reviewedHunkIds
                  : [...session.reviewedHunkIds, hunkId],
                lastVisitedHunkId: hunkId,
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
        completeHunkSession: (repoPath, sessionId) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                completedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
        resetHunkSession: (repoPath, sessionId) =>
          set((state) => ({
            projects: updateProject(state.projects, repoPath, (project) =>
              updateHunkSession(project, sessionId, (session) => ({
                ...session,
                reviewedHunkIds: [],
                lastVisitedHunkId: null,
                completedAt: null,
                updatedAt: new Date().toISOString(),
              })),
            ),
          })),
      },
    }),
    {
      name: "athas-review-queue",
      version: 1,
      storage: createSafeJSONStorage<Pick<ReviewState, "projects">>(),
      partialize: ({ projects }) => ({ projects }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Pick<ReviewState, "projects">),
        actions: currentState.actions,
      }),
    },
  ),
);

export const useReviewStore = createSelectors(useReviewStoreBase);
