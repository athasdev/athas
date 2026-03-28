import type React from "react";
import { memo } from "react";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard-store";
import type { FileEntry } from "@/features/file-system/types/app";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { FileExplorerIcon } from "./file-explorer-icon";

interface FileExplorerTreeItemProps {
  file: FileEntry;
  depth: number;
  isExpanded: boolean;
  isActive: boolean;
  dragOverPath: string | null;
  isDragging: boolean;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  // Row events now delegated at container level
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusClass: (file: FileEntry) => string;
}

function FileExplorerTreeItemComponent({
  file,
  depth,
  isExpanded,
  isActive,
  dragOverPath,
  isDragging,
  editingValue,
  onEditingValueChange,
  onKeyDown,
  onBlur,
  getGitStatusClass,
}: FileExplorerTreeItemProps) {
  const isCut = useFileClipboardStore(
    (s) =>
      s.clipboard?.operation === "cut" && s.clipboard.entries.some((e) => e.path === file.path),
  );
  const paddingLeft = 14 + depth * 20;
  const treeGuideStyle = {
    "--tree-depth": depth,
  } as React.CSSProperties;

  if (file.isEditing || file.isRenaming) {
    return (
      <div className="file-tree-item w-full" data-depth={depth} style={treeGuideStyle}>
        <div
          className="file-tree-row flex min-h-[22px] w-full items-center gap-1.5 rounded-md px-1.5 py-0.5"
          style={{
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
          }}
        >
          <FileExplorerIcon
            fileName={file.isDir ? "folder" : "file"}
            isDir={file.isDir}
            isExpanded={false}
            className="relative z-[1] shrink-0 text-text-lighter"
          />
          <Input
            ref={(el) => {
              if (el) {
                el.focus();
                el.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                  inline: "nearest",
                });
              }
            }}
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            value={editingValue}
            onFocus={() => {
              if (file.isRenaming) {
                onEditingValueChange(file.name);
              }
            }}
            onChange={(e) => onEditingValueChange(e.target.value)}
            onKeyDown={(e) => onKeyDown(e, file)}
            onBlur={() => onBlur(file)}
            variant="ghost"
            className="ui-font relative z-[1] flex-1 border-text border-b px-0 focus:border-text-lighter"
            placeholder={file.isDir ? "folder name" : "file name"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree-item w-full" data-depth={depth} style={treeGuideStyle}>
      <button
        type="button"
        data-file-path={file.path}
        data-is-dir={file.isDir}
        data-path={file.path}
        data-depth={depth}
        title={
          file.isSymlink && file.symlinkTarget ? `Symlink to: ${file.symlinkTarget}` : undefined
        }
        className={cn(
          "file-tree-row ui-font flex min-h-[22px] w-full min-w-max cursor-pointer select-none items-center gap-1.5",
          "whitespace-nowrap border-none bg-transparent px-1.5 py-0.5 text-left text-text text-xs",
          "outline-none transition-colors duration-150",
          "rounded-md hover:bg-hover focus:outline-none",
          isActive && "bg-selected",
          dragOverPath === file.path &&
            "!border-2 !border-dashed !border-accent !bg-accent !bg-opacity-20",
          isDragging && "cursor-move",
          file.ignored && "opacity-50",
          isCut && "italic opacity-40",
        )}
        style={
          {
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
            height: "22px",
          } as React.CSSProperties
        }
      >
        <FileExplorerIcon
          fileName={file.name}
          isDir={file.isDir}
          isExpanded={isExpanded}
          isSymlink={file.isSymlink}
          className="relative z-[1] shrink-0 text-text-lighter"
        />
        <span
          className={cn("relative z-[1] select-none whitespace-nowrap", getGitStatusClass(file))}
        >
          {file.name}
        </span>
      </button>
    </div>
  );
}

export const FileExplorerTreeItem = memo(
  FileExplorerTreeItemComponent,
  (prev, next) =>
    prev.file === next.file &&
    prev.depth === next.depth &&
    prev.isExpanded === next.isExpanded &&
    prev.isActive === next.isActive &&
    prev.dragOverPath === next.dragOverPath &&
    prev.isDragging === next.isDragging &&
    prev.editingValue === next.editingValue &&
    prev.onEditingValueChange === next.onEditingValueChange &&
    prev.onKeyDown === next.onKeyDown &&
    prev.onBlur === next.onBlur &&
    prev.getGitStatusClass === next.getGitStatusClass,
);
