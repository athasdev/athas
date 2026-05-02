import { invoke } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { getAuthToken } from "@/features/window/services/auth-api";

export const GITHUB_ACCOUNT_API_BASE = "https://athas.dev";
export const GITHUB_CONNECTION_URL = `${GITHUB_ACCOUNT_API_BASE}/dashboard/settings/integrations`;

export type GitHubTokenSyncStatus = "synced" | "notSignedIn" | "notConnected";

export interface GitHubTokenSyncResult {
  status: GitHubTokenSyncStatus;
  accountLogin?: string | null;
  scopes?: string | null;
}

interface DesktopGitHubTokenResponse {
  token?: unknown;
  accountLogin?: unknown;
  scopes?: unknown;
}

export const storeGitHubToken = async (token: string): Promise<void> => {
  try {
    await invoke("store_github_token", { token });
  } catch (error) {
    console.error("Error storing GitHub token:", error);
    throw error;
  }
};

export const removeGitHubToken = async (): Promise<void> => {
  try {
    await invoke("remove_github_token");
  } catch (error) {
    console.error("Error removing GitHub token:", error);
    throw error;
  }
};

export const syncGitHubTokenFromAccount = async (): Promise<GitHubTokenSyncResult> => {
  const token = await getAuthToken();
  if (!token) {
    return { status: "notSignedIn" };
  }

  const response = await tauriFetch(`${GITHUB_ACCOUNT_API_BASE}/api/desktop/github/token`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 || response.status === 403) {
    await removeGitHubToken();
    return { status: "notSignedIn" };
  }

  if (response.status === 400 || response.status === 404) {
    await removeGitHubToken();
    return { status: "notConnected" };
  }

  if (!response.ok) {
    throw new Error(`Failed to sync GitHub token: ${response.status}`);
  }

  const payload = (await response.json()) as DesktopGitHubTokenResponse;
  const githubToken = typeof payload.token === "string" ? payload.token.trim() : "";

  if (!githubToken) {
    await removeGitHubToken();
    return { status: "notConnected" };
  }

  await storeGitHubToken(githubToken);

  return {
    status: "synced",
    accountLogin: typeof payload.accountLogin === "string" ? payload.accountLogin : null,
    scopes: typeof payload.scopes === "string" ? payload.scopes : null,
  };
};
