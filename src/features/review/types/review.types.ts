import type { GitCommit } from "@/features/git/types/git.types";

export type ReviewViewMode = "queue" | "timeline" | "risk";
export type ReviewRiskLevel = "high" | "medium" | "low";

export interface ReviewFileSummary {
  path: string;
  additions: number;
  deletions: number;
}

export type ReviewChangeSetKind = "working-tree" | "commit" | "agent-session";

/** One file an agent session rewrote, from its state before the session to now. */
export interface AgentChangeFile {
  path: string;
  oldText: string;
  newText: string;
}

export interface AgentChangeSession {
  sessionId: string;
  title: string;
  workspacePath: string | null;
  startedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  files: Record<string, AgentChangeFile>;
}

export interface ReviewChangeSet {
  id: string;
  kind: ReviewChangeSetKind;
  /** Set on agent-session change sets; identifies the chat that produced them. */
  sessionId?: string;
  title: string;
  description?: string;
  author?: string;
  date?: string;
  commit?: GitCommit;
  files: ReviewFileSummary[];
  additions: number;
  deletions: number;
  risk: ReviewRiskLevel;
  riskReasons: string[];
  categories: string[];
  reviewed: boolean;
}

export interface ProjectReviewState {
  reviewedThroughHash: string | null;
  reviewedCommitHashes: string[];
  reviewedWorkingTreeFingerprint: string | null;
  viewMode: ReviewViewMode;
  lastReviewedAt: string | null;
  hunkSessions?: Record<string, ReviewHunkSessionState>;
}

export interface ReviewHunkSessionState {
  reviewedHunkIds: string[];
  attentionHunkIds?: string[];
  summaries: Record<string, ReviewHunkSummary | string>;
  insights?: Record<string, Partial<Record<ReviewHunkInsightKind, ReviewHunkInsight>>>;
  lastVisitedHunkId: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface ReviewHunkSummary {
  title: string;
  description: string;
}

export type ReviewHunkInsightKind = "explain" | "risks" | "tests" | "comment";

export interface ReviewHunkInsight {
  kind: ReviewHunkInsightKind;
  title: string;
  items: string[];
}
