import { useEffect, useMemo, useState } from "react";
import { cn } from "@/utils/cn";

interface GitHubAvatarProps {
  login?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  size?: number;
  className?: string;
}

export function GitHubAvatar({ login, name, avatarUrl, size = 32, className }: GitHubAvatarProps) {
  const [failed, setFailed] = useState(false);
  const label = (login || name || "GitHub user").trim();
  const src = useMemo(() => {
    if (avatarUrl?.trim()) return avatarUrl.trim();
    if (login?.trim()) {
      return `https://github.com/${encodeURIComponent(login.trim())}.png?size=${size}`;
    }
    return null;
  }, [avatarUrl, login, size]);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={label}
        className={cn("shrink-0 rounded-full bg-secondary-bg object-cover", className)}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      className={cn(
        "ui-text-sm flex shrink-0 items-center justify-center rounded-full bg-secondary-bg text-text-lighter",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {(label.charAt(0) || "?").toUpperCase()}
    </span>
  );
}
