import { invoke } from "@tauri-apps/api/core";

/**
 * Which credential Athas is currently authenticating GitHub with.
 *
 * Athas mints only the `athas` token; the other two belong to the user. A `gh`
 * token in particular is read from the CLI on demand and never leaves the
 * machine — it is not persisted into Athas' own keychain entry.
 */
export type GitHubTokenSource = "athas" | "personalAccessToken" | "ghCli";

export interface GitHubTokenStatus {
  source: GitHubTokenSource | null;
  hasPersonalAccessToken: boolean;
  hasAthasAccountToken: boolean;
  ghCliInstalled: boolean;
  login: string | null;
  /** Space-separated OAuth scopes, or null for fine-grained tokens. */
  scopes: string | null;
}

export interface GhCliAvailability {
  installed: boolean;
  /** True when `gh` is also logged in, so switching to it would actually work. */
  hasToken: boolean;
}

export const getGhCliAvailability = async (): Promise<GhCliAvailability> =>
  await invoke<GhCliAvailability>("github_gh_cli_availability");

export const getGitHubTokenStatus = async (): Promise<GitHubTokenStatus> =>
  await invoke<GitHubTokenStatus>("github_token_status");

export const storeGitHubPersonalAccessToken = async (token: string): Promise<void> => {
  await invoke("store_github_personal_access_token", { token });
};

export const removeGitHubPersonalAccessToken = async (): Promise<void> => {
  await invoke("remove_github_personal_access_token");
};

/** Drops the cached `gh` token so the next call re-reads the CLI. */
export const refreshGitHubGhCliToken = async (): Promise<void> => {
  await invoke("refresh_github_gh_cli_token");
};

export const GITHUB_TOKEN_SOURCE_LABELS: Record<GitHubTokenSource, string> = {
  athas: "Athas account",
  personalAccessToken: "Personal access token",
  ghCli: "GitHub CLI (gh)",
};

/** Scopes worth warning about: they can destroy or re-configure things. */
const DESTRUCTIVE_SCOPES = ["delete_repo", "admin:org", "admin:enterprise", "delete:packages"];

export const getDestructiveScopes = (scopes: string | null): string[] => {
  if (!scopes) return [];
  const granted = new Set(scopes.split(/[\s,]+/).filter(Boolean));
  return DESTRUCTIVE_SCOPES.filter((scope) => granted.has(scope));
};
