import { authenticatedFetch } from "@/features/auth/services/auth-api";

export type CloudAgentId = "claude-code" | "codex";

export type CloudAgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface CloudAgentRun {
  id: string;
  repo: string;
  baseBranch: string;
  branch: string;
  title: string;
  agent: CloudAgentId;
  status: CloudAgentRunStatus;
  pool: "included_allowance" | "prepaid_wallet";
  maxMinutes: number;
  billedSeconds: number;
  chargedCents: number;
  holdCents: number;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  prompt?: string;
}

export interface CloudAgentLogLine {
  at: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface StartCloudAgentRunInput {
  repo: string;
  baseBranch: string;
  prompt: string;
  agent: CloudAgentId;
  maxMinutes: number;
  credentials: { anthropicApiKey?: string; openaiApiKey?: string };
}

export class CloudAgentsError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "CloudAgentsError";
  }
}

export function isActiveCloudAgentRun(run: Pick<CloudAgentRun, "status">) {
  return run.status === "queued" || run.status === "running";
}

async function cloudAgentsRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/cloud-agents${path}`, init);
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok)
    throw new CloudAgentsError(
      body.error || "Cloud agents are temporarily unavailable.",
      response.status,
      body.code,
    );
  return body as T;
}

export async function listCloudAgentRuns() {
  return (await cloudAgentsRequest<{ runs: CloudAgentRun[] }>("/runs")).runs;
}

export async function startCloudAgentRun(input: StartCloudAgentRunInput) {
  return (
    await cloudAgentsRequest<{ run: CloudAgentRun }>("/runs", {
      method: "POST",
      body: JSON.stringify(input),
    })
  ).run;
}

export async function cancelCloudAgentRun(id: string) {
  return (
    await cloudAgentsRequest<{ run: CloudAgentRun }>(`/runs/${encodeURIComponent(id)}/cancel`, {
      method: "POST",
    })
  ).run;
}

export async function getCloudAgentRunLogs(id: string, after: number) {
  return cloudAgentsRequest<{ lines: CloudAgentLogLine[]; cursor: number }>(
    `/runs/${encodeURIComponent(id)}/logs?after=${after}`,
  );
}
