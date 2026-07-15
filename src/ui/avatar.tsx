import { useEffect, useState } from "react";
import { cn } from "@/utils/cn";

interface AvatarProps {
  name: string;
  src?: string | null;
  className?: string;
}

export function getAvatarInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

export function Avatar({ name, src, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);
  const imageSource = src?.trim() || null;
  const label = name.trim() || "Unknown author";

  useEffect(() => {
    setFailed(false);
  }, [imageSource]);

  if (imageSource && !failed) {
    return (
      <img
        src={imageSource}
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
        "ui-text-sm flex shrink-0 items-center justify-center rounded-full bg-secondary-bg font-medium text-text-lighter",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {getAvatarInitials(label)}
    </span>
  );
}
