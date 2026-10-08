import { getGitHubAvatarUrl } from "@/features/github/services/github-avatar-url";
import type { AuthUser } from "@/features/auth/services/auth-api";

export function getAccountIdentity(user: AuthUser | null, githubLogin?: string | null) {
  const name = user?.name || githubLogin || user?.email || "Account";

  return {
    name,
    detail: githubLogin ? `@${githubLogin}` : user?.email,
    githubLogin: githubLogin || null,
    avatarUrl: getGitHubAvatarUrl(
      {
        login: githubLogin,
        avatarUrl: user?.avatar_url,
      },
      64,
    ),
  };
}
