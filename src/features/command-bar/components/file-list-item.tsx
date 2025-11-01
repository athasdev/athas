import { ClockIcon, File } from "lucide-react";
import { CommandItem } from "@/ui/command";
import { getDirectoryPath } from "@/utils/path-helpers";
import type { FileCategory, FileItem } from "../types/command-bar";

interface FileListItemProps {
  file: FileItem;
  category: FileCategory;
  index: number;
  isSelected: boolean;
  onClick: (path: string) => void;
  rootFolderPath: string | null | undefined;
}

export const FileListItem = ({
  file,
  category,
  index,
  isSelected,
  onClick,
  rootFolderPath,
}: FileListItemProps) => {
  const directoryPath = getDirectoryPath(file.path, rootFolderPath);

  return (
    <CommandItem
      key={`${category}-${file.path}`}
      data-item-index={index}
      onClick={() => onClick(file.path)}
      isSelected={isSelected}
      className="font-mono"
    >
      <File
        size={11}
        className={`flex-shrink-0 ${category === "open" ? "text-accent" : "text-text-lighter"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">
          <span className="text-text">{file.name}</span>
          {directoryPath && (
            <span className="ml-1.5 text-[10px] text-text-lighter opacity-60">{directoryPath}</span>
          )}
        </div>
      </div>
      {category === "open" && (
        <span className="rounded bg-accent/20 px-1 py-0.5 font-medium text-[10px] text-accent">
          open
        </span>
      )}
      {category === "recent" && (
        <span className="rounded px-1 py-0.5 font-medium text-[10px] text-text-lighter">
          <ClockIcon size={12} />
        </span>
      )}
    </CommandItem>
  );
};
