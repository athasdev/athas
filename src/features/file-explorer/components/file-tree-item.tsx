import type React from "react";
import { memo } from "react";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-clipboard-store";
import type { FileEntry } from "@/features/file-system/types/app";
import { cn } from "@/utils/cn";
import { FileIcon } from "./file-icon";

interface FileTreeItemProps {
  file: FileEntry;
  depth: number;
  isExpanded: boolean;
  activePath?: string;
  dragOverPath: string | null;
  isDragging: boolean;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  // Row events now delegated at container level
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusClass: (file: FileEntry) => string;
}

function FileTreeItemComponent({
  file,
  depth,
  isExpanded,
  activePath,
  dragOverPath,
  isDragging,
  editingValue,
  onEditingValueChange,
  onKeyDown,
  onBlur,
  getGitStatusClass,
}: FileTreeItemProps) {
  const isCut = useFileClipboardStore(
    (s) =>
      s.clipboard?.operation === "cut" && s.clipboard.entries.some((e) => e.path === file.path),
  );
  const paddingLeft = 14 + depth * 20;

  if (file.isEditing || file.isRenaming) {
    return (
      <div className="file-tree-item w-full" data-depth={depth}>
        <div
          className="flex min-h-[20px] w-full items-center gap-1.5 px-1.5 py-0.5"
          style={{ paddingLeft: `${paddingLeft}px`, paddingRight: "8px" }}
        >
          <FileIcon
            fileName={file.isDir ? "folder" : "file"}
            isDir={file.isDir}
            isExpanded={false}
            className="shrink-0 text-text-lighter"
          />
          <input
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
            className="ui-font flex-1 border-text border-b border-none bg-transparent text-text text-xs outline-none focus:border-text-lighter"
            placeholder={file.isDir ? "folder name" : "file name"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree-item w-full" data-depth={depth}>
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
          "ui-font flex min-h-[20px] w-full min-w-max cursor-pointer select-none items-center gap-1.5",
          "whitespace-nowrap border-none bg-transparent px-1.5 py-0.5 text-left text-text text-xs",
          "shadow-none outline-none transition-colors duration-150",
          "hover:bg-hover focus:outline-none",
          activePath === file.path && "bg-selected",
          dragOverPath === file.path &&
            "!border-2 !border-dashed !border-accent !bg-accent !bg-opacity-20",
          isDragging && "cursor-move",
          file.ignored && "opacity-50",
          isCut && "opacity-40 italic",
        )}
        style={
          {
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
            height: "22px",
          } as React.CSSProperties
        }
      >
        <FileIcon
          fileName={file.name}
          isDir={file.isDir}
          isExpanded={isExpanded}
          isSymlink={file.isSymlink}
          className="shrink-0 text-text-lighter"
        />
        <span className={cn("select-none whitespace-nowrap", getGitStatusClass(file))}>
          {file.name}
        </span>
      </button>
    </div>
  );
}

export const FileTreeItem = memo(FileTreeItemComponent);
