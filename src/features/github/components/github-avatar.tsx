import { useMemo } from "react";
import { Avatar } from "@/ui/avatar";
import { getGitHubAvatarUrl } from "../utils/github-avatar-url";

interface GitHubAvatarProps {
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function GitHubAvatar({ login, name, avatarUrl, size = 32, className }: GitHubAvatarProps) {
  const label = (login || name || "GitHub user").trim();
  const src = useMemo(
    () => getGitHubAvatarUrl({ login, avatarUrl }, size),
    [avatarUrl, login, size],
  );

  return <Avatar name={label} src={src} className={className} />;
}
