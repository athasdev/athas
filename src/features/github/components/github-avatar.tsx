import { useMemo } from "react";
import { Avatar } from "@/ui/avatar";

interface GitHubAvatarProps {
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function GitHubAvatar({ login, name, avatarUrl, size = 32, className }: GitHubAvatarProps) {
  const label = (login || name || "GitHub user").trim();
  const src = useMemo(() => {
    if (avatarUrl?.trim()) return avatarUrl.trim();
    if (login?.trim()) {
      return `https://github.com/${encodeURIComponent(login.trim())}.png?size=${size}`;
    }
    return null;
  }, [avatarUrl, login, size]);

  return <Avatar name={label} src={src} className={className} />;
}
