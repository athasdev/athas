import type React from "react";
import { memo } from "react";
import type { FileEntry } from "@/features/file-system/types/app";
import { cn } from "@/utils/cn";
import { FileIcon } from "./file-icon";

interface FileTreeItemProps {
  file: FileEntry;
  depth: number;
  activePath?: string;
  dragOverPath: string | null;
  isDragging: boolean;
  deepestStickyFolder: string | null;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onMouseDown: (e: React.MouseEvent, file: FileEntry) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: () => void;
  onMouseLeave: () => void;
  onClick: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onDoubleClick: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onContextMenu: (e: React.MouseEvent, path: string, isDir: boolean) => void;
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusColor: (file: FileEntry) => string;
  renderChildren?: (children: FileEntry[], depth: number) => React.ReactNode;
}

function FileTreeItemComponent({
  file,
  depth,
  activePath,
  dragOverPath,
  isDragging,
  deepestStickyFolder,
  editingValue,
  onEditingValueChange,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onMouseLeave,
  onClick,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  onBlur,
  getGitStatusColor,
  renderChildren,
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
        {file.expanded && file.children && renderChildren?.(file.children, depth + 1)}
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
        onMouseDown={(e) => onMouseDown(e, file)}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onClick={(e) => onClick(e, file.path, file.isDir)}
        onDoubleClick={(e) => onDoubleClick(e, file.path, file.isDir)}
        onContextMenu={(e) => onContextMenu(e, file.path, file.isDir)}
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
          file.isDir && "file-tree-item-dir",
          file.isDir && deepestStickyFolder === file.path && "border-white/5 border-b",
        )}
        style={
          {
            paddingLeft: `${paddingLeft}px`,
            paddingRight: "8px",
            "--depth": depth,
          } as React.CSSProperties & { "--depth": number }
        }
      >
        <FileIcon
          fileName={file.name}
          isDir={file.isDir}
          isExpanded={file.expanded}
          isSymlink={file.isSymlink}
          className="shrink-0 text-text-lighter"
        />
        <span className={cn("select-none whitespace-nowrap", getGitStatusColor(file))}>
          {file.name}
        </span>
      </button>
      {file.expanded && file.children && renderChildren?.(file.children, depth + 1)}
    </div>
  );
}

export const FileTreeItem = memo(FileTreeItemComponent);
