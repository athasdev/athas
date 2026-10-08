import { useAssetUrl } from "@/features/workspace/project-icons/hooks/use-asset-url";
import {
  findProjectSymbol,
  getProjectIconCategory,
} from "@/features/workspace/project-icons/utils/project-symbols";
import { FolderIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

export function ProjectCustomIcon({
  value,
  className,
  imageClassName,
}: {
  value: string;
  className?: string;
  /** Extra classes for image files only, which often carry their own transparent margin. */
  imageClassName?: string;
}) {
  const symbol = findProjectSymbol(value);
  const isImageFile = getProjectIconCategory(value) === "files";
  const imageSrc = useAssetUrl(isImageFile ? value : null);
  if (symbol?.emoji) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex size-[1em] shrink-0 items-center justify-center leading-none",
          className,
        )}
      >
        {symbol.emoji}
      </span>
    );
  }
  if (symbol?.icon) {
    const Icon = symbol.icon;
    return <Icon aria-hidden="true" className={cn("size-[1em] shrink-0", className)} />;
  }
  if (!isImageFile) return <FolderIcon aria-hidden="true" className={className} />;
  if (!imageSrc)
    return <span aria-hidden="true" className={cn("size-[1em] shrink-0", className)} />;
  return (
    <img
      src={imageSrc}
      alt=""
      className={cn("size-[1em] shrink-0 rounded-md object-contain", className, imageClassName)}
    />
  );
}
