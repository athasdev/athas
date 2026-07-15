import type { AuthUser } from "@/features/window/services/auth-api";
import type { GitCommit } from "../types/git.types";

type GitAuthorAccount = Pick<AuthUser, "email" | "avatar_url" | "github_username">;

function getGitHubLoginFromEmail(email: string) {
  const match = email
    .trim()
    .toLowerCase()
    .match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/);
  return match?.[1] || null;
}

function getGitHubAvatarUrl(login: string) {
  return `https://github.com/${encodeURIComponent(login)}.png?size=64`;
}

export function getGitAuthorAvatarUrl(commit: GitCommit, account: GitAuthorAccount | null) {
  const commitEmail = commit.email?.trim().toLowerCase() || "";
  const accountEmail = account?.email.trim().toLowerCase() || "";

  if (account && commitEmail && commitEmail === accountEmail) {
    if (account.avatar_url?.trim()) return account.avatar_url.trim();
    if (account.github_username?.trim()) {
      return getGitHubAvatarUrl(account.github_username.trim());
    }
  }

  const githubLogin = getGitHubLoginFromEmail(commitEmail);
  return githubLogin ? getGitHubAvatarUrl(githubLogin) : null;
}
