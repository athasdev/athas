interface GitHubAvatarIdentity {
  login?: string | null;
  avatarUrl?: string | null;
}

export function getGitHubAvatarUrl(
  { login, avatarUrl }: GitHubAvatarIdentity,
  size = 32,
): string | undefined {
  const explicitUrl = avatarUrl?.trim();
  if (explicitUrl) return explicitUrl;

  const normalizedLogin = login?.trim();
  if (!normalizedLogin || normalizedLogin.endsWith("[bot]")) return undefined;

  return `https://github.com/${encodeURIComponent(normalizedLogin)}.png?size=${size}`;
}
