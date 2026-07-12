import { ClockIcon } from "@/ui/icons";
import { memo } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
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
      <CommandItemRow
        id={id}
        key={`${category}-${file.path}`}
        data-item-index={index}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        onClick={() => onClick(file.path)}
        onMouseEnter={onPreview ? () => onPreview(file.path) : undefined}
        isSelected={isSelected}
        className={compact ? "min-h-7 rounded-md px-2 py-1" : undefined}
        icon={<ThemedFileIcon fileName={file.name} isDir={false} />}
        title={file.name}
        description={directoryPath}
        accessory={
          category === "open" ? (
            <CommandItemBadge>open</CommandItemBadge>
          ) : category === "recent" ? (
            <CommandItemBadge>
              <ClockIcon />
            </CommandItemBadge>
          ) : undefined
        }
      />
    );
  },
);
