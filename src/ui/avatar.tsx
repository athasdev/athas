import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { memo, useState } from "react";
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

type AvatarImageStatus = "loading" | "loaded" | "error";

const loadedAvatarImageSources = new Set<string>();

export const Avatar = memo(function Avatar({ name, src, className }: AvatarProps) {
  const imageSource = src?.trim() || undefined;
  const label = name.trim() || "Unknown author";
  const [resolvedImage, setResolvedImage] = useState<{
    source: string;
    status: AvatarImageStatus;
  } | null>(null);
  const imageStatus = imageSource
    ? resolvedImage?.source === imageSource
      ? resolvedImage.status
      : loadedAvatarImageSources.has(imageSource)
        ? "loaded"
        : "loading"
    : "error";

  const handleImageLoad = () => {
    if (!imageSource) return;
    loadedAvatarImageSources.add(imageSource);
    setResolvedImage({ source: imageSource, status: "loaded" });
  };

  const handleImageError = () => {
    if (!imageSource) return;
    loadedAvatarImageSources.delete(imageSource);
    setResolvedImage({ source: imageSource, status: "error" });
  };

  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {imageSource && imageStatus !== "error" ? (
        <img
          src={imageSource}
          alt={label}
          decoding="async"
          onLoad={handleImageLoad}
          onError={handleImageError}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        className={cn(
          "ui-text-sm flex size-full items-center justify-center font-medium text-subtle-foreground",
          imageStatus === "loaded" && "invisible",
        )}
      >
        {getAvatarInitials(label)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
