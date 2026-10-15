import { CODEX_INTEGRATION_ID } from "@/features/ai/integrations/integration-registry";
import { CLAUDE_ACP_AGENT_ID } from "@/features/ai/lib/claude-code";
import type {
  AgentType,
  ChatCloudEnvironment,
  ChatCloudRun,
} from "@/features/ai/types/ai-chat.types";
import {
  type CloudAgentBranches,
  type CloudAgentId,
  type CloudAgentRepo,
  type CloudAgentRun,
  CloudAgentsError,
} from "./cloud-agents-api";

export type AgentEnvironmentKind = "local" | "cloud";

/** The agent a cloud run starts for each local agent that can also run in the cloud. */
const CLOUD_AGENTS: Readonly<Record<string, CloudAgentId>> = {
  [CLAUDE_ACP_AGENT_ID]: "claude-code",
  [CODEX_INTEGRATION_ID]: "codex",
};

export const DEFAULT_CLOUD_AGENT_ID: AgentType = CLAUDE_ACP_AGENT_ID;
export const DEFAULT_CLOUD_MAX_MINUTES = 60;
export const CLOUD_MAX_MINUTES_OPTIONS = [30, 60, 120] as const;

export function toCloudAgentId(agentId: AgentType | null | undefined): CloudAgentId | null {
  return agentId ? (CLOUD_AGENTS[agentId] ?? null) : null;
}

export function fromCloudAgentId(agent: CloudAgentId): AgentType {
  return agent === "codex" ? CODEX_INTEGRATION_ID : CLAUDE_ACP_AGENT_ID;
}

export function cloudAgentLabel(agent: CloudAgentId) {
  return agent === "codex" ? "Codex" : "Claude Code";
}

export function emptyCloudEnvironment(
  patch: Partial<ChatCloudEnvironment> = {},
): ChatCloudEnvironment {
  return { repo: null, branch: null, runs: [], ...patch };
}

/**
 * The branch a cloud run starts from when the user has not picked one: the branch checked out
 * here when the remote has it, otherwise the repository's default branch. Without a branch list
 * the checked-out branch is the best guess.
 */
export function pickDefaultCloudBranch({
  localBranch,
  remote,
}: {
  localBranch: string | null | undefined;
  remote: CloudAgentBranches | null | undefined;
}): string | null {
  if (!remote) return localBranch || null;
  if (localBranch && remote.branches.includes(localBranch)) return localBranch;
  return remote.defaultBranch ?? remote.branches[0] ?? localBranch ?? null;
}

/** The project's own repository first, then the most recently pushed. */
export function orderCloudRepos(
  repos: readonly CloudAgentRepo[],
  projectRepo: string | null | undefined,
): CloudAgentRepo[] {
  const project = projectRepo?.toLowerCase();
  const pushedAt = (repo: CloudAgentRepo) => (repo.pushedAt ? Date.parse(repo.pushedAt) || 0 : 0);
  const ordered = [...repos].sort((left, right) => {
    const leftIsProject = left.fullName.toLowerCase() === project;
    const rightIsProject = right.fullName.toLowerCase() === project;
    if (leftIsProject !== rightIsProject) return leftIsProject ? -1 : 1;
    return pushedAt(right) - pushedAt(left);
  });
  if (projectRepo && !ordered.some((repo) => repo.fullName.toLowerCase() === project)) {
    ordered.unshift({ fullName: projectRepo, defaultBranch: null, private: false, pushedAt: null });
  }
  return ordered;
}

/** The run a session sent last, which is the one its composer and boxes speak about. */
export function getLatestCloudRun(cloud: ChatCloudEnvironment | null | undefined) {
  return cloud?.runs[cloud.runs.length - 1] ?? null;
}

/**
 * Where a follow-up run starts: from the branch the previous run pushed its pull request from, so
 * it keeps building on that work, otherwise from the environment's branch.
 */
export function getNextRunBaseBranch(
  cloud: ChatCloudEnvironment,
  previousRun: Pick<CloudAgentRun, "branch" | "prUrl" | "status"> | null | undefined,
): string | null {
  if (previousRun?.status === "succeeded" && previousRun.prUrl && previousRun.branch)
    return previousRun.branch;
  return cloud.branch;
}

/** Credit a run has spent, in millionths of a dollar. */
export function getRunSpentMicros(
  run: Pick<CloudAgentRun, "spentMicros" | "chargedCents">,
): number {
  if (typeof run.spentMicros === "number") return run.spentMicros;
  return Math.round(run.chargedCents * 10_000);
}

/** Seconds the run's sandbox has been up: measured while it runs, billed once it ends. */
export function getRunSandboxSeconds(
  run: Pick<CloudAgentRun, "status" | "startedAt" | "billedSeconds">,
  now: number,
): number {
  if (run.status === "running" && run.startedAt) {
    const started = Date.parse(run.startedAt);
    if (Number.isFinite(started)) return Math.max(0, Math.floor((now - started) / 1000));
  }
  return run.billedSeconds;
}

export function formatSandboxTime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function formatCreditMicros(micros: number) {
  const dollars = micros / 1_000_000;
  return dollars > 0 && dollars < 0.01 ? "<$0.01" : `$${dollars.toFixed(2)}`;
}

export interface PullRequestRef {
  repo: string;
  number: number;
}

export function parsePullRequestUrl(url: string | null | undefined): PullRequestRef | null {
  const match = url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  return match ? { repo: match[1]!, number: Number(match[2]) } : null;
}

export type CloudProblemAction = "connect-github" | "open-billing" | "see-plans" | "retry";

export interface CloudProblem {
  title: string;
  description: string;
  action: CloudProblemAction | null;
  actionLabel?: string;
}

/** What to tell the user about a run that could not start, and the one thing that fixes it. */
export function describeCloudProblem(error: { message: string; code?: string }): CloudProblem {
  switch (error.code) {
    case "github_not_connected":
      return {
        title: "Connect GitHub",
        description: "Cloud agents clone your repository and open a pull request through GitHub.",
        action: "connect-github",
        actionLabel: "Connect GitHub",
      };
    case "allowance_exhausted":
      return {
        title: "Out of Athas credit",
        description: "Add credit to keep running agents in the cloud.",
        action: "open-billing",
        actionLabel: "Add credit",
      };
    case "spend_cap_reached":
      return {
        title: "Spend limit reached",
        description: "Raise your monthly spend limit in billing to start another run.",
        action: "open-billing",
        actionLabel: "Open billing",
      };
    case "pro_required":
      return {
        title: "Cloud agents are part of Athas Pro",
        description: "Upgrade to run agents in the cloud and get a pull request back.",
        action: "see-plans",
        actionLabel: "See plans",
      };
    case "model_unavailable":
      return {
        title: "Model unavailable",
        description: error.message || "This model cannot run in the cloud right now.",
        action: "retry",
        actionLabel: "Try again",
      };
    default:
      return {
        title: "The run could not start",
        description: error.message || "Cloud agents are temporarily unavailable.",
        action: "retry",
        actionLabel: "Try again",
      };
  }
}

export function toCloudRunError(error: unknown): NonNullable<ChatCloudRun["error"]> {
  if (error instanceof CloudAgentsError)
    return error.code ? { message: error.message, code: error.code } : { message: error.message };
  return { message: error instanceof Error ? error.message : "The run could not start." };
}
