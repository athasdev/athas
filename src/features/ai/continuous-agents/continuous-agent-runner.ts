import { isTerminalAgent } from "@/features/ai/lib/terminal-agents";
import type { AgentConfig } from "@/features/ai/types/acp.types";
import type { ContinuousAgentTask } from "./continuous-agents.store";

export type ContinuousAgentReadiness =
  | { status: "ready" }
  | { status: "blocked"; reason: string }
  | { status: "retry" };

interface ContinuousAgentReadinessDependencies {
  loadAcpAgents: () => Promise<AgentConfig[]>;
  loadCodexStatus: () => Promise<{ installed: boolean }>;
}

export async function checkContinuousAgentReadiness(
  task: ContinuousAgentTask,
  dependencies: ContinuousAgentReadinessDependencies,
): Promise<ContinuousAgentReadiness> {
  if (task.agentId === "custom") {
    return {
      status: "blocked",
      reason: "Choose Codex or an installed ACP agent for continuous runs.",
    };
  }

  if (isTerminalAgent(task.agentId)) {
    return {
      status: "blocked",
      reason: "Terminal agents cannot run as Continuous Agents.",
    };
  }

  if (task.agentId === "codex") {
    try {
      const status = await dependencies.loadCodexStatus();
      return status.installed
        ? { status: "ready" }
        : { status: "blocked", reason: "Codex is not installed or available." };
    } catch {
      return { status: "retry" };
    }
  }

  try {
    const agents = await dependencies.loadAcpAgents();
    const agent = agents.find((candidate) => candidate.id === task.agentId);
    if (!agent) {
      return {
        status: "blocked",
        reason: "This agent is no longer available in the Agent catalog.",
      };
    }
    return agent.installed
      ? { status: "ready" }
      : { status: "blocked", reason: `${agent.name} is not installed.` };
  } catch {
    return { status: "retry" };
  }
}

export interface ContinuousAgentRunDependencies {
  getWorkspacePath: () => string | null;
  isAgentBusy: () => boolean;
  getDueTask: (workspacePath: string, now: number) => ContinuousAgentTask | null;
  checkReadiness: (task: ContinuousAgentTask) => Promise<ContinuousAgentReadiness>;
  claimTask: (
    workspacePath: string,
    now: number,
    expectedTaskId: string,
  ) => ContinuousAgentTask | null;
  launchTask: (task: ContinuousAgentTask) => void;
  pauseTask: (taskId: string, reason: string) => void;
  now?: () => number;
}

export type ContinuousAgentRunResult =
  | { status: "idle" | "busy" | "retry" }
  | { status: "started" | "paused"; task: ContinuousAgentTask; reason?: string };

function launchErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return "Athas could not start this continuous agent.";
}

export async function runNextDueContinuousAgent(
  dependencies: ContinuousAgentRunDependencies,
): Promise<ContinuousAgentRunResult> {
  const workspacePath = dependencies.getWorkspacePath();
  if (!workspacePath) return { status: "idle" };
  if (dependencies.isAgentBusy()) return { status: "busy" };

  const now = dependencies.now?.() ?? Date.now();
  const dueTask = dependencies.getDueTask(workspacePath, now);
  if (!dueTask) return { status: "idle" };

  const readiness = await dependencies.checkReadiness(dueTask);
  if (readiness.status === "retry") return { status: "retry" };
  if (readiness.status === "blocked") {
    dependencies.pauseTask(dueTask.id, readiness.reason);
    return { status: "paused", task: dueTask, reason: readiness.reason };
  }

  if (dependencies.getWorkspacePath() !== workspacePath) return { status: "idle" };
  if (dependencies.isAgentBusy()) return { status: "busy" };

  const claimedTask = dependencies.claimTask(workspacePath, now, dueTask.id);
  if (!claimedTask) return { status: "idle" };

  try {
    dependencies.launchTask(claimedTask);
    return { status: "started", task: claimedTask };
  } catch (error) {
    const reason = launchErrorMessage(error);
    dependencies.pauseTask(claimedTask.id, reason);
    return { status: "paused", task: claimedTask, reason };
  }
}

export function buildContinuousAgentPrompt(name: string, prompt: string) {
  return [
    `You are running the continuous goal “${name}” in this workspace.`,
    "Make meaningful progress autonomously, verify the result, and leave a concise handoff in this session.",
    "If the goal is already satisfied, inspect the current state and report evidence instead of inventing work.",
    "",
    prompt,
  ].join("\n");
}
