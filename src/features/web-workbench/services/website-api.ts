import {
  isWorkspaceSession,
  type WorkspaceSession,
} from "@/features/web-workbench/services/workspace-protocol";

/**
 * The athas.dev APIs the web app calls. It is served from the website's own origin (athas.dev/app),
 * so every request carries the website's session cookie and nothing else: no tokens are stored
 * in the page.
 */

export interface WebsiteUser {
  id: number;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export type WebsiteAccount =
  | { status: "signed-out" }
  | {
      status: "signed-in";
      user: WebsiteUser;
      plan: "free" | "pro";
      /** Pro with the cloud Worker configured: GitHub repositories open in a cloud workspace. */
      cloudEditor: boolean;
      githubConnected: boolean;
    };

export interface GithubRepository {
  fullName: string;
  private: boolean;
  description: string | null;
}

export interface RepositoryBranches {
  defaultBranch: string | null;
  branches: string[];
}

export type CloudWorkspaceStatus = "starting" | "running" | "stopped" | "failed";

export interface CloudWorkspace {
  id: string;
  repo: string;
  branch: string;
  status: CloudWorkspaceStatus;
  stopReason: string | null;
  error: string | null;
}

export class WebsiteApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "WebsiteApiError";
  }
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function parseUser(value: unknown): WebsiteUser | null {
  if (!isRecord(value) || typeof value.id !== "number" || typeof value.email !== "string")
    return null;
  return {
    id: value.id,
    email: value.email,
    name: stringOrNull(value.name),
    avatarUrl: stringOrNull(value.avatarUrl) ?? stringOrNull(value.avatar_url),
  };
}

function parseWorkspace(value: unknown): CloudWorkspace {
  const workspace = isRecord(value) ? value : {};
  const status = workspace.status;
  if (
    typeof workspace.id !== "string" ||
    typeof workspace.repo !== "string" ||
    typeof workspace.branch !== "string" ||
    (status !== "starting" && status !== "running" && status !== "stopped" && status !== "failed")
  )
    throw new WebsiteApiError("The server sent an unexpected workspace.", 502);
  return {
    id: workspace.id,
    repo: workspace.repo,
    branch: workspace.branch,
    status,
    stopReason: stringOrNull(workspace.stopReason),
    error: stringOrNull(workspace.error),
  };
}

export function isOpenWorkspace(workspace: Pick<CloudWorkspace, "status"> | null | undefined) {
  return workspace?.status === "starting" || workspace?.status === "running";
}

export function createWebsiteApi(fetchImpl: Fetch) {
  async function request(path: string, init: RequestInit = {}) {
    const response = await fetchImpl(path, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const body = isRecord(payload) ? payload : {};
      throw new WebsiteApiError(
        stringOrNull(body.error) ?? `The request failed (${response.status}).`,
        response.status,
        stringOrNull(body.code) ?? undefined,
      );
    }
    return isRecord(payload) ? payload : {};
  }

  async function githubConnected() {
    try {
      return (await request("/api/integrations/github")).connected === true;
    } catch {
      return false;
    }
  }

  return {
    /** Who is signed in to athas.dev, and what the account may do in the app. */
    async getAccount(): Promise<WebsiteAccount> {
      const user = parseUser((await request("/api/auth/me")).user);
      if (!user) return { status: "signed-out" };
      let plan: "free" | "pro" = "free";
      let cloudEditor = false;
      try {
        const subscription = await request("/api/auth/subscription");
        plan = subscription.status === "pro" ? "pro" : "free";
        cloudEditor =
          isRecord(subscription.capabilities) && subscription.capabilities.cloudEditor === true;
      } catch (error) {
        // The session ended between the two requests.
        if (error instanceof WebsiteApiError && error.status === 401)
          return { status: "signed-out" };
        throw error;
      }
      return {
        status: "signed-in",
        user,
        plan,
        cloudEditor,
        githubConnected: cloudEditor ? await githubConnected() : false,
      };
    },

    async signOut() {
      await request("/api/auth/sign-out", { method: "POST" });
    },

    async listRepositories(): Promise<GithubRepository[]> {
      const { repos } = await request("/api/integrations/github/repos");
      return (Array.isArray(repos) ? repos : []).filter(isRecord).flatMap((repo) =>
        typeof repo.fullName === "string"
          ? [
              {
                fullName: repo.fullName,
                private: repo.private === true,
                description: stringOrNull(repo.description),
              },
            ]
          : [],
      );
    },

    async listBranches(repo: string): Promise<RepositoryBranches> {
      const payload = await request(
        `/api/cloud-workspaces/branches?repo=${encodeURIComponent(repo)}`,
      );
      const branches = (Array.isArray(payload.branches) ? payload.branches : []).flatMap(
        (branch) => (isRecord(branch) && typeof branch.name === "string" ? [branch.name] : []),
      );
      return { defaultBranch: stringOrNull(payload.defaultBranch), branches };
    },

    async listWorkspaces(): Promise<CloudWorkspace[]> {
      const { workspaces } = await request("/api/cloud-workspaces");
      return (Array.isArray(workspaces) ? workspaces : []).map(parseWorkspace);
    },

    /** Opens a workspace for the repository and branch, or returns the one already open. */
    async openWorkspace(repo: string, branch: string) {
      const { workspace } = await request("/api/cloud-workspaces", {
        method: "POST",
        body: JSON.stringify({ repo, branch }),
      });
      return parseWorkspace(workspace);
    },

    async getWorkspace(id: string) {
      const { workspace } = await request(`/api/cloud-workspaces/${encodeURIComponent(id)}`);
      return parseWorkspace(workspace);
    },

    async stopWorkspace(id: string) {
      const { workspace } = await request(`/api/cloud-workspaces/${encodeURIComponent(id)}/stop`, {
        method: "POST",
      });
      return parseWorkspace(workspace);
    },

    /** A fresh session for a running workspace: the Worker's URL and a ten-minute token. */
    async createWorkspaceSession(id: string): Promise<WorkspaceSession> {
      const { session } = await request(`/api/cloud-workspaces/${encodeURIComponent(id)}/token`, {
        method: "POST",
      });
      if (!isWorkspaceSession(session) || session.workspaceId !== id)
        throw new WebsiteApiError("The server sent an unexpected workspace session.", 502);
      return session;
    },
  };
}

export type WebsiteApi = ReturnType<typeof createWebsiteApi>;
