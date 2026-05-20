import type React from "react";
import { memo } from "react";
import { CaretDoubleUp, FolderOpen, Minus } from "@phosphor-icons/react";
import {
  FILE_TREE_DENSITY_CONFIG,
  type FileTreeDensity,
} from "@/features/file-explorer/lib/file-tree-density";
import type { FileTreeGitStatusDecoration } from "@/features/file-explorer/lib/file-tree-git-status";
import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard-store";
import type { FileEntry } from "@/features/file-system/types/app";
import Input from "@/ui/input";
import { TreeRow } from "@/ui/tree-row";
import { cn } from "@/utils/cn";
import { FileExplorerIcon } from "./file-explorer-icon";

export const FILE_TREE_BASE_INDENT = 10;

export interface FileTreeGuideTarget {
  path: string;
  name: string;
  isDir: boolean;
  isActive: boolean;
}

export interface FileTreeRowAnimation {
  delay: number;
  duration: number;
  phase: "opening-block" | "closing-block" | "closing";
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
  isWorkspaceRoot: boolean;
  rowAnimation?: FileTreeRowAnimation | null;
  dragOverPath: string | null;
  isDragging: boolean;
  editingValue: string;
  onEditingValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent, file: FileEntry) => void;
  onBlur: (file: FileEntry) => void;
  onCollapseDirectory: (path: string, isWorkspaceRoot: boolean) => void;
  getGitStatusDecoration: (file: FileEntry) => FileTreeGitStatusDecoration | null;
  searchQuery?: string;
  isSearchMatch?: boolean;
  rowId?: string;
}

function renderHighlightedLabel(label: string, query: string | undefined) {
  const trimmedQuery = query?.trim();
  if (!trimmedQuery) return label;

  const labelLower = label.toLowerCase();
  const queryLower = trimmedQuery.toLowerCase();
  const matchIndex = labelLower.indexOf(queryLower);

  if (matchIndex === -1) return label;

  return (
    <>
      {label.slice(0, matchIndex)}
      <mark className="file-tree-search-highlight">
        {label.slice(matchIndex, matchIndex + trimmedQuery.length)}
      </mark>
      {label.slice(matchIndex + trimmedQuery.length)}
    </>
  );
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
  isWorkspaceRoot,
  rowAnimation,
  dragOverPath,
  isDragging,
  editingValue,
  onEditingValueChange,
  onKeyDown,
  onBlur,
  onCollapseDirectory,
  getGitStatusDecoration,
  searchQuery,
  isSearchMatch = false,
  rowId,
}: FileExplorerTreeItemProps) {
  const isCut = useFileClipboardStore(
    (s) =>
      s.clipboard?.operation === "cut" && s.clipboard.entries.some((e) => e.path === file.path),
  );
  const paddingLeft = FILE_TREE_BASE_INDENT + depth * indentSize;
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
                left: `calc(${FILE_TREE_BASE_INDENT + level * indentSize}px + var(--file-tree-guide-icon-offset, 7px))`,
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
      <div
        className="file-tree-item w-full"
        data-depth={depth}
        style={
          {
            "--file-tree-row-height": `${densityConfig.rowHeight}px`,
          } as React.CSSProperties
        }
      >
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
    <div
      className="file-tree-item w-full"
      data-active={isActive ? "true" : undefined}
      data-depth={depth}
      data-row-animation={rowAnimation?.phase}
      data-expanded={isExpanded ? "true" : undefined}
      data-is-dir={file.isDir ? "true" : undefined}
      style={
        {
          "--file-tree-row-height": `${densityConfig.rowHeight}px`,
          ...(rowAnimation
            ? {
                "--file-tree-row-animation-delay": `${rowAnimation.delay}ms`,
                "--file-tree-row-animation-duration": `${rowAnimation.duration}ms`,
              }
            : {}),
        } as React.CSSProperties
      }
    >
      {renderTreeGuides()}
      <TreeRow
        id={rowId}
        role="treeitem"
        aria-level={depth + 1}
        aria-selected={isActive}
        aria-expanded={file.isDir ? isExpanded : undefined}
        data-file-path={file.path}
        data-is-dir={file.isDir}
        data-path={file.path}
        data-depth={depth}
        title={
          file.isSymlink && file.symlinkTarget ? `Symlink to: ${file.symlinkTarget}` : undefined
        }
        className={cn(
          densityConfig.rowClassName,
          file.isDir && isExpanded && "pr-7",
          dragOverPath === file.path &&
            "!border-2 !border-dashed !border-accent !bg-accent !bg-opacity-20",
          isDragging && "cursor-move",
          file.ignored && "opacity-50",
          isCut && "italic opacity-40",
          isSearchMatch && "file-tree-search-match",
        )}
        active={isActive}
        baseIndent={FILE_TREE_BASE_INDENT}
        depth={depth}
        indentSize={indentSize}
      >
        {isWorkspaceRoot ? (
          <FolderOpen
            size={14}
            weight="duotone"
            className="relative z-1 shrink-0 text-text-lighter"
          />
        ) : (
          <FileExplorerIcon
            fileName={file.name}
            isDir={file.isDir}
            isExpanded={isExpanded}
            isSymlink={file.isSymlink}
            className="relative z-1 shrink-0 text-text-lighter"
          />
        )}
        <span
          className={cn(
            "relative z-1 select-none whitespace-nowrap",
            gitStatusDecoration?.colorClassName,
          )}
        >
          {renderHighlightedLabel(displayName ?? file.name, searchQuery)}
        </span>
      </TreeRow>
      {file.isDir && isExpanded ? (
        <button
          type="button"
          className="file-tree-row-action"
          aria-label={
            isWorkspaceRoot
              ? `Collapse everything under ${displayName ?? file.name}`
              : `Collapse ${displayName ?? file.name}`
          }
          title={isWorkspaceRoot ? "Collapse descendants" : "Collapse folder"}
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCollapseDirectory(file.path, isWorkspaceRoot);
          }}
        >
          {isWorkspaceRoot ? <Minus weight="bold" /> : <CaretDoubleUp weight="bold" />}
        </button>
      ) : null}
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
    prev.isWorkspaceRoot === next.isWorkspaceRoot &&
    prev.rowAnimation?.delay === next.rowAnimation?.delay &&
    prev.rowAnimation?.duration === next.rowAnimation?.duration &&
    prev.rowAnimation?.phase === next.rowAnimation?.phase &&
    prev.dragOverPath === next.dragOverPath &&
    prev.isDragging === next.isDragging &&
    prev.editingValue === next.editingValue &&
    prev.onEditingValueChange === next.onEditingValueChange &&
    prev.onKeyDown === next.onKeyDown &&
    prev.onBlur === next.onBlur &&
    prev.onCollapseDirectory === next.onCollapseDirectory &&
    prev.getGitStatusDecoration === next.getGitStatusDecoration &&
    prev.searchQuery === next.searchQuery &&
    prev.isSearchMatch === next.isSearchMatch &&
    prev.rowId === next.rowId,
);
