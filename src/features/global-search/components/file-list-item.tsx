import { ClockIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { CommandItem } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import { cn } from "@/utils/cn";
import type { FileCategory, FileItem } from "../types/global-search.types";

interface FileListItemProps {
  id?: string;
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  onPreview?: (path: string) => void;
  rootFolderPath: string | null | undefined;
  compact?: boolean;
}

export const FileListItem = memo(
  ({
    file,
    id,
    category,
    index,
    isSelected,
    onClick,
    onPreview,
    rootFolderPath,
    compact = false,
  }: FileListItemProps) => {
    const directoryPath = getDirectoryPath(file.path, rootFolderPath);

    return (
      <CommandItem
        id={id}
        key={`${category}-${file.path}`}
        data-item-index={index}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        onClick={() => onClick(file.path)}
        onMouseEnter={onPreview ? () => onPreview(file.path) : undefined}
        isSelected={isSelected}
        className={
          compact
            ? "ui-font !h-auto min-h-7 !min-w-0 gap-2 rounded-md px-2 py-1 ui-text-base leading-[1.35]"
            : "ui-font ui-text-base leading-[1.35]"
        }
      >
        <ThemedFileIcon fileName={file.name} isDir={false} className="shrink-0" />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div
            className={cn(
              "flex min-w-0 items-baseline truncate leading-[1.35]",
              compact ? "ui-text-base gap-2" : "ui-text-base gap-1.5",
            )}
          >
            <span className="min-w-0 max-w-[45%] shrink truncate text-text">{file.name}</span>
            {directoryPath && (
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-text-lighter leading-[1.35] opacity-60",
                  compact ? "ui-text-base" : "ui-text-base",
                )}
              >
                {directoryPath}
              </span>
            )}
          </div>
        </div>
        {category === "open" && (
          <span
            className={cn(
              "rounded-full bg-accent/20 px-1 font-medium leading-[1.35] text-accent",
              compact ? "ui-text-base py-0" : "ui-text-base py-0.5",
            )}
          >
            open
          </span>
        )}
        {category === "recent" && (
          <span
            className={cn(
              "rounded px-1 font-medium leading-[1.35] text-text-lighter",
              compact ? "ui-text-base py-0" : "ui-text-base py-0.5",
            )}
          >
            <ClockIcon />
          </span>
        )}
      </CommandItem>
    );
  },
);
