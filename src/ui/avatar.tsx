import { Avatar as AvatarPrimitive } from "@base-ui/react/avatar";
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
  const imageSource = src?.trim() || undefined;
  const label = name.trim() || "Unknown author";

  return (
    <AvatarPrimitive.Root
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface",
        className,
      )}
      title={label}
      aria-label={label}
    >
      {imageSource ? (
        <AvatarPrimitive.Image
          key={imageSource}
          src={imageSource}
          alt={label}
          loading="lazy"
          className="size-full object-cover"
        />
      ) : null}
      <AvatarPrimitive.Fallback
        delay={imageSource ? 150 : 0}
        className="ui-text-sm flex size-full items-center justify-center font-medium text-subtle-foreground"
      >
        {getAvatarInitials(label)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
