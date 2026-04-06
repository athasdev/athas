import { ClockIcon } from "lucide-react";
import { memo } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { CommandItem } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import type { FileCategory, FileItem } from "../models/types";

interface FileListItemProps {
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  onPreview?: (path: string) => void;
  rootFolderPath: string | null | undefined;
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
  }: FileListItemProps) => {
    const directoryPath = getDirectoryPath(file.path, rootFolderPath);

    return (
      <CommandItem
        key={`${category}-${file.path}`}
        data-item-index={index}
        onClick={() => onClick(file.path)}
        onMouseEnter={onPreview ? () => onPreview(file.path) : undefined}
        isSelected={isSelected}
        className="ui-font"
      >
        <FileExplorerIcon fileName={file.name} isDir={false} size={12} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="ui-text-sm truncate">
            <span className="text-text">{file.name}</span>
            {directoryPath && (
              <span className="ui-text-sm ml-1.5 text-text-lighter opacity-60">
                {directoryPath}
              </span>
            )}
          </div>
        </div>
        {category === "open" && (
          <span className="ui-text-sm rounded bg-accent/20 px-1 py-0.5 font-medium text-accent">
            open
          </span>
        )}
        {category === "recent" && (
          <span className="ui-text-sm rounded px-1 py-0.5 font-medium text-text-lighter">
            <ClockIcon />
          </span>
        )}
      </CommandItem>
    );
  },
);
