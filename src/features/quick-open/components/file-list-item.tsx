import { ClockIcon } from "@/ui/icons";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { CommandItemBadge, CommandItemRow } from "@/ui/command";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { getDirectoryPath } from "@/utils/path-helpers";
import type { FileCategory, FileItem } from "@/features/file-search/types/file-search.types";

interface FileListItemProps {
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  onMouseMove?: (index: number, path: string) => void;
  rootFolderPath: string | null | undefined;
  searchQuery: string;
}

export const FileListItem = ({
  file,
  category,
  index,
  isSelected,
  onClick,
  onMouseMove,
  rootFolderPath,
  searchQuery,
}: FileListItemProps) => {
  const directoryPath = getDirectoryPath(file.path, rootFolderPath);

  return (
    <CommandItemRow
      key={`${category}-${file.path}`}
      as="div"
      id={`quick-open-option-${index}`}
      role="option"
      tabIndex={-1}
      aria-selected={isSelected}
      data-item-index={index}
      onClick={() => onClick(file.path)}
      onMouseMove={() => onMouseMove?.(index, file.path)}
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
