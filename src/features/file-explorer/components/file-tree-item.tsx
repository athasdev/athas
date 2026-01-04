import { Minus } from "lucide-react";
import type React from "react";
import { memo } from "react";
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
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusClass: (file: FileEntry) => string;
  isRoot?: boolean;
  onCollapseAll?: () => void;
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
  isRoot,
  onCollapseAll,
}: FileTreeItemProps) {
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
        <span className={cn("flex-1 select-none whitespace-nowrap", getGitStatusClass(file))}>
          {file.name}
        </span>
        {isRoot && onCollapseAll && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Collapse all folders"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCollapseAll();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onCollapseAll();
              }
            }}
            className="ml-auto shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:bg-hover hover:opacity-100"
          >
            <Minus size={12} />
          </span>
        )}
      </button>
    </div>
  );
}

export const FileTreeItem = memo(FileTreeItemComponent);
