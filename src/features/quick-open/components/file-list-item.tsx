import { ClockIcon } from "@phosphor-icons/react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import type { FileCategory, FileItem } from "../types/quick-open.types";
import { SearchMatchHighlight } from "./search-match-highlight";

interface FileListItemProps {
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  onMouseEnter?: (index: number, path: string) => void;
  rootFolderPath: string | null | undefined;
  searchQuery: string;
}

export const FileListItem = ({
  file,
  category,
  index,
  isSelected,
  onClick,
  onMouseEnter,
  rootFolderPath,
  searchQuery,
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
      title={<SearchMatchHighlight text={file.name} query={searchQuery} />}
      description={<SearchMatchHighlight text={directoryPath} query={searchQuery} />}
      accessory={
        category === "recent" ? (
          <CommandItemBadge>
            <ClockIcon />
          </CommandItemBadge>
        ) : undefined
      }
    />
  );
};
