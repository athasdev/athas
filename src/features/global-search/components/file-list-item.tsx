import { Clock as ClockIcon } from "@phosphor-icons/react";
import { memo } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { CommandItem } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import { cn } from "@/utils/cn";
import type { FileCategory, FileItem } from "../models/types";

interface FileListItemProps {
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
        key={`${category}-${file.path}`}
        data-item-index={index}
        onClick={() => onClick(file.path)}
        onMouseEnter={onPreview ? () => onPreview(file.path) : undefined}
        isSelected={isSelected}
        className={compact ? "ui-font !h-6 !min-w-0 gap-1.5 rounded-md px-1.5 py-0" : "ui-font"}
      >
        <FileExplorerIcon
          fileName={file.name}
          isDir={false}
          size={compact ? 11 : 12}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <div className={cn("truncate", compact ? "ui-text-xs" : "ui-text-sm")}>
            <span className="text-text">{file.name}</span>
            {directoryPath && (
              <span
                className={cn(
                  "ml-1.5 text-text-lighter opacity-60",
                  compact ? "ui-text-xs" : "ui-text-sm",
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
              "rounded bg-accent/20 px-1 font-medium text-accent",
              compact ? "ui-text-xs py-0" : "ui-text-sm py-0.5",
            )}
          >
            open
          </span>
        )}
        {category === "recent" && (
          <span
            className={cn(
              "rounded px-1 font-medium text-text-lighter",
              compact ? "ui-text-xs py-0" : "ui-text-sm py-0.5",
            )}
          >
            <ClockIcon />
          </span>
        )}
      </CommandItem>
    );
  },
);
