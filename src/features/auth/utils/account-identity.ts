import type { AuthUser } from "@/features/auth/services/auth-api";

type LinkedAvatarUrl = (login: string, size: number) => string | undefined;

export function getAccountIdentity(
  user: AuthUser | null,
  githubLogin?: string | null,
  getLinkedAvatarUrl?: LinkedAvatarUrl,
) {
  const name = user?.name || githubLogin || user?.email || "Account";
  const explicitAvatarUrl = user?.avatar_url?.trim();

  return {
    name,
    detail: githubLogin ? `@${githubLogin}` : user?.email,
    githubLogin: githubLogin || null,
    avatarUrl:
      explicitAvatarUrl ||
      (githubLogin?.trim() ? getLinkedAvatarUrl?.(githubLogin.trim(), 64) : undefined),
  };
}
