import { authenticatedFetch } from "@/features/auth/services/auth-api";

export type CloudAgentId = "claude-code" | "codex";

export type CloudAgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** `athas`: the run spends the user's Athas credit; `own-key`: it runs on their own API key. */
export type CloudAgentBilling = "athas" | "own-key";

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
  billing?: CloudAgentBilling;
  /** Credit the run has spent so far, sandbox and model use together, in millionths of a dollar. */
  spentMicros?: number;
  spendCapMicros?: number;
}

export interface CloudAgentLogLine {
  at: number;
  stream: "stdout" | "stderr" | "system";
  text: string;
}

export interface CloudAgentCredentials {
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export interface StartCloudAgentRunInput {
  repo: string;
  baseBranch: string;
  prompt: string;
  title?: string;
  agent: CloudAgentId;
  model?: string;
  maxMinutes?: number;
  /** Only sent when the user chose to run on their own API key; Athas credit pays otherwise. */
  credentials?: CloudAgentCredentials;
}

export interface CloudAgentRepo {
  fullName: string;
  defaultBranch: string | null;
  private: boolean;
  pushedAt: string | null;
}

export interface CloudAgentBranches {
  defaultBranch: string | null;
  branches: string[];
}

export type CloudAgentsErrorCode =
  | "pro_required"
  | "github_not_connected"
  | "allowance_exhausted"
  | "spend_cap_reached"
  | "model_unavailable"
  | "unavailable";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await authenticatedFetch(path, init);
  } catch (cause) {
    throw new CloudAgentsError(
      cause instanceof Error && cause.message === "Not authenticated"
        ? "Sign in to Athas to run agents in the cloud."
        : "Athas could not be reached. Check your connection and try again.",
      0,
      "unavailable",
    );
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!response.ok)
    throw new CloudAgentsError(
      body.error || "Cloud agents are temporarily unavailable.",
      response.status,
      body.code,
    );
  return body as T;
}

const cloudAgentsRequest = <T>(path: string, init?: RequestInit) =>
  request<T>(`/api/cloud-agents${path}`, init);

export async function listCloudAgentRuns() {
  return (await cloudAgentsRequest<{ runs: CloudAgentRun[] }>("/runs")).runs;
}

export async function getCloudAgentRun(id: string) {
  return (await cloudAgentsRequest<{ run: CloudAgentRun }>(`/runs/${encodeURIComponent(id)}`)).run;
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

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function parseRepos(repos: unknown): CloudAgentRepo[] {
  if (!Array.isArray(repos)) return [];
  return repos.flatMap((repo) => {
    if (!repo || typeof repo !== "object") return [];
    const record = repo as Record<string, unknown>;
    if (typeof record.fullName !== "string") return [];
    return [
      {
        fullName: record.fullName,
        defaultBranch: stringOrNull(record.defaultBranch),
        private: record.private === true,
        pushedAt: stringOrNull(record.pushedAt),
      },
    ];
  });
}

/**
 * The GitHub repositories a run can work on. Servers without the cloud agents listing answer from
 * the GitHub integration's repository list instead.
 */
export async function listCloudAgentRepos(): Promise<CloudAgentRepo[]> {
  try {
    return parseRepos((await cloudAgentsRequest<{ repos?: unknown }>("/repos")).repos);
  } catch (error) {
    if (!(error instanceof CloudAgentsError) || (error.status !== 404 && error.status !== 405))
      throw error;
  }
  return parseRepos((await request<{ repos?: unknown }>("/api/integrations/github/repos")).repos);
}

export async function listCloudAgentBranches(repo: string): Promise<CloudAgentBranches> {
  const payload = await request<{ defaultBranch?: unknown; branches?: unknown }>(
    `/api/cloud-workspaces/branches?repo=${encodeURIComponent(repo)}`,
  );
  const branches = (Array.isArray(payload.branches) ? payload.branches : []).flatMap(
    (branch: unknown) => {
      if (typeof branch === "string") return [branch];
      if (branch && typeof branch === "object" && "name" in branch) {
        const name = (branch as { name?: unknown }).name;
        return typeof name === "string" ? [name] : [];
      }
      return [];
    },
  );
  return { defaultBranch: stringOrNull(payload.defaultBranch), branches };
}
