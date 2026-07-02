import { ClockIcon } from "@phosphor-icons/react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import type { FileCategory, FileItem } from "../types/quick-open.types";

interface FileListItemProps {
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  onMouseEnter?: (index: number, path: string) => void;
  rootFolderPath: string | null | undefined;
}

export const FileListItem = ({
  file,
  category,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  rootFolderPath,
}: FileListItemProps) => {
  const directoryPath = getDirectoryPath(file.path, rootFolderPath);

  return (
    <CommandItemRow
      key={`${category}-${file.path}`}
      data-item-index={index}
      onClick={() => onClick(file.path)}
      onMouseEnter={() => onMouseEnter?.(index, file.path)}
      isSelected={isSelected}
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
};
