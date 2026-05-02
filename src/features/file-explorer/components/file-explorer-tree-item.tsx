import type React from "react";
import { memo } from "react";
import {
  FILE_TREE_DENSITY_CONFIG,
  type FileTreeDensity,
} from "@/features/file-explorer/lib/file-tree-density";
import type { FileTreeGitStatusDecoration } from "@/features/file-explorer/lib/file-tree-git-status";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard-store";
import type { FileEntry } from "@/features/file-system/types/app";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { FileExplorerIcon } from "./file-explorer-icon";

export interface FileTreeGuideTarget {
  path: string;
  name: string;
  isDir: boolean;
  isActive: boolean;
}

function areGuideTargetsEqual(
  previous: Array<FileTreeGuideTarget | null>,
  next: Array<FileTreeGuideTarget | null>,
): boolean {
  if (previous.length !== next.length) return false;

  return previous.every((previousTarget, index) => {
    const nextTarget = next[index];
    if (previousTarget === nextTarget) return true;
    if (!previousTarget || !nextTarget) return false;

    return (
      previousTarget.path === nextTarget.path &&
      previousTarget.name === nextTarget.name &&
      previousTarget.isDir === nextTarget.isDir &&
      previousTarget.isActive === nextTarget.isActive
    );
  });
}

interface FileExplorerTreeItemProps {
  file: FileEntry;
  depth: number;
  displayName?: string;
  guideTargets: Array<FileTreeGuideTarget | null>;
  previousDepth: number;
  nextDepth: number;
  indentSize: number;
  density: FileTreeDensity;
  isExpanded: boolean;
  isActive: boolean;
  dragOverPath: string | null;
  isDragging: boolean;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  getGitStatusDecoration: (file: FileEntry) => FileTreeGitStatusDecoration | null;
}

function FileExplorerTreeItemComponent({
  file,
  depth,
  displayName,
  guideTargets,
  previousDepth,
  nextDepth,
  indentSize,
  density,
  isExpanded,
  isActive,
  dragOverPath,
  isDragging,
  editingValue,
  onEditingValueChange,
  onKeyDown,
  onBlur,
  getGitStatusDecoration,
}: FileExplorerTreeItemProps) {
  const isCut = useFileClipboardStore(
    (s) =>
      s.clipboard?.operation === "cut" && s.clipboard.entries.some((e) => e.path === file.path),
  );
  const paddingLeft = 14 + depth * indentSize;
  const densityConfig = FILE_TREE_DENSITY_CONFIG[density];
  const gitStatusDecoration = getGitStatusDecoration(file);
  const guideLevels = Array.from({ length: depth }, (_, level) => level);
  const renderTreeGuides = () => (
    <div className="file-tree-guides">
      {guideLevels.map((level) => {
        const target = guideTargets[level];
        const startsHere = previousDepth <= level;
        const endsHere = nextDepth <= level;
        return (
          <span
            key={level}
            className="file-tree-guide"
            data-file-path={target?.path}
            data-is-dir={target?.isDir}
            data-path={target?.path}
            data-active={target?.isActive ? "true" : undefined}
            title={target?.name}
            style={
              {
                left: `calc(${14 + level * indentSize}px + var(--file-tree-guide-icon-offset, 7px))`,
                top: startsHere ? "4px" : "0",
                bottom: endsHere ? "4px" : "0",
              } as React.CSSProperties
            }
          />
        );
      })}
    </div>
  );

  if (file.isEditing || file.isRenaming) {
    return (
      <div className="file-tree-item w-full" data-depth={depth}>
        {renderTreeGuides()}
        <div
          className={cn(
            "file-tree-row flex w-full items-center rounded-md",
            densityConfig.rowClassName,
          )}
          style={{
            paddingLeft: `${paddingLeft}px`,
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
            className="ui-font relative z-1 flex-1 border-text border-b px-0 focus:border-text-lighter"
            placeholder={file.isDir ? "folder name" : "file name"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="file-tree-item w-full" data-depth={depth}>
      {renderTreeGuides()}
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
          "file-tree-row ui-font flex w-full min-w-max cursor-pointer select-none items-center whitespace-nowrap rounded-md border-none bg-transparent text-left text-text text-xs outline-none transition-colors duration-150 hover:bg-hover focus:outline-none",
          densityConfig.rowClassName,
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
          } as React.CSSProperties
        }
      >
        <FileExplorerIcon
          fileName={file.name}
          isDir={file.isDir}
          isExpanded={isExpanded}
          isSymlink={file.isSymlink}
          className="relative z-1 shrink-0 text-text-lighter"
        />
        <span
          className={cn(
            "relative z-1 select-none whitespace-nowrap",
            gitStatusDecoration?.colorClassName,
          )}
        >
          {displayName ?? file.name}
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
    prev.displayName === next.displayName &&
    areGuideTargetsEqual(prev.guideTargets, next.guideTargets) &&
    prev.previousDepth === next.previousDepth &&
    prev.nextDepth === next.nextDepth &&
    prev.indentSize === next.indentSize &&
    prev.density === next.density &&
    prev.isExpanded === next.isExpanded &&
    prev.isActive === next.isActive &&
    prev.dragOverPath === next.dragOverPath &&
    prev.isDragging === next.isDragging &&
    prev.editingValue === next.editingValue &&
    prev.onEditingValueChange === next.onEditingValueChange &&
    prev.onKeyDown === next.onKeyDown &&
    prev.onBlur === next.onBlur &&
    prev.getGitStatusDecoration === next.getGitStatusDecoration,
);
