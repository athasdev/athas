import { commands } from "@/bindings/commands";
import type { GitHubTokenSource } from "@/bindings/commands";

/**
 * Which credential Athas is currently authenticating GitHub with.
 *
 * Athas mints only the `athas` token; the other two belong to the user. A `gh`
 * token in particular is read from the CLI on demand and never leaves the
 * machine — it is not persisted into Athas' own keychain entry.
 */
export type { GitHubTokenStatus } from "@/bindings/commands";

export const getGhCliAvailability = async () => await commands.githubGhCliAvailability();

export const getGitHubTokenStatus = async () => await commands.githubTokenStatus();

export const storeGitHubPersonalAccessToken = async (token: string): Promise<void> => {
  await commands.storeGithubPersonalAccessToken(token);
};

export const removeGitHubPersonalAccessToken = async (): Promise<void> => {
  await commands.removeGithubPersonalAccessToken();
};

/** Drops the cached `gh` token so the next call re-reads the CLI. */
export const refreshGitHubGhCliToken = async (): Promise<void> => {
  await commands.refreshGithubGhCliToken();
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
