import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
import { cva, type VariantProps } from "class-variance-authority";
import { memo, useState } from "react";
import { cn } from "@/utils/cn";

const avatarVariants = cva(
  "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent font-sans font-medium text-muted-foreground ring-1 ring-border ring-inset select-none",
  {
    variants: {
      size: {
        /** Inline with text: menu rows, chips, tab labels. */
        sm: "size-4 ui-text-caption",
        /** List rows and headers. */
        md: "size-6 ui-text-caption",
        /** Profile blocks and cards. */
        lg: "size-8 ui-text-sm",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type AvatarSize = NonNullable<VariantProps<typeof avatarVariants>["size"]>;

interface AvatarProps extends VariantProps<typeof avatarVariants> {
  name: string;
  src?: string | null;
  className?: never;
  style?: never;
}

export function getAvatarInitials(name: string, letters: 1 | 2 = 2) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";

  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 && letters === 2 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

type AvatarImageStatus = "loading" | "loaded" | "error";

const loadedAvatarImageSources = new Set<string>();

export const Avatar = memo(function Avatar({ name, src, size }: AvatarProps) {
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
      data-size={size ?? "md"}
      className={avatarVariants({ size })}
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
          "flex size-full items-center justify-center leading-none",
          imageStatus === "loaded" && "invisible",
        )}
      >
        {getAvatarInitials(label, size === "sm" ? 1 : 2)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
});
