import { useMemo } from "react";
import { Avatar, type AvatarSize } from "@/ui/avatar";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";

interface GitHubAvatarProps {
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  displaySize?: AvatarSize;
}

export function GitHubAvatar({
  login,
  name,
  avatarUrl,
  size = 32,
  displaySize,
}: GitHubAvatarProps) {
  const label = (login || name || "GitHub user").trim();
  const src = useMemo(
    () => getGitHubAvatarUrl({ login, avatarUrl }, size),
    [avatarUrl, login, size],
  );

  return <Avatar name={label} src={src} size={displaySize} />;
}
