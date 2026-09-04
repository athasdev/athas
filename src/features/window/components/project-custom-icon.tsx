import { convertFileSrc } from "@tauri-apps/api/core";
import { findProjectSymbol, getProjectIconCategory } from "@/features/window/utils/project-symbols";
import { FolderIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

export function ProjectCustomIcon({ value, className }: { value: string; className?: string }) {
  const symbol = findProjectSymbol(value);
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
  if (getProjectIconCategory(value) !== "files")
    return <FolderIcon aria-hidden="true" className={className} />;
  return (
    <img
      src={convertFileSrc(value)}
      alt=""
      className={cn("size-[1em] shrink-0 rounded-md object-contain", className)}
    />
  );
}
