import {
  PulseIcon as Activity,
  DatabaseIcon as Database,
  GitBranchIcon as GitBranch,
  GitPullRequestIcon as GitPullRequest,
  GlobeHemisphereWestIcon as Globe,
  MagnifyingGlassIcon as Search,
  ChatCircleTextIcon as MessageSquare,
  PackageIcon as Package,
  PushPinIcon as Pin,
  SparkleIcon as Sparkles,
  TerminalWindowIcon as Terminal,
  WarningCircleIcon as WarningCircle,
  XIcon as X,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useState } from "react";
import type { RefCallback } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { TabBarTab } from "@/ui/tabs";
import { getBaseName } from "@/utils/path-helpers";
import { cn } from "@/utils/cn";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";

interface TabBarItemProps {
  buffer: PaneContent;
  displayName: string;
  index: number;
  isActive: boolean;
  isDraggedTab: boolean;
  showDropIndicatorBefore?: boolean;
  tabRef?: RefCallback<HTMLDivElement>;
  onClick?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onDoubleClick: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  handleTabClose: (id: string) => void;
  handleTabPin: (id: string) => void;
  isEditing: boolean;
  editingName: string;
  onEditingNameChange: (value: string) => void;
  onRenameSubmit: (value: string) => void;
  onRenameCancel: () => void;
}

const TabBarItem = memo(function TabBarItem({
  buffer,
  displayName,
  isActive,
  isDraggedTab,
  showDropIndicatorBefore = false,
  tabRef,
  onClick,
  onMouseDown,
  onDoubleClick,
  onContextMenu,
  onKeyDown,
  handleTabClose,
  handleTabPin,
  isEditing,
  editingName,
  onEditingNameChange,
  onRenameSubmit,
  onRenameCancel,
}: TabBarItemProps) {
  const [faviconError, setFaviconError] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const authorAvatarUrl =
    buffer.type === "pullRequest" || buffer.type === "githubIssue"
      ? buffer.authorAvatarUrl
      : undefined;

  useEffect(() => {
    setAvatarError(false);
  }, [authorAvatarUrl]);

  const getDiffIconName = () => {
    if (buffer.type !== "diff") return buffer.name;
    if (buffer.path === "diff://working-tree/all-files") return null;

    const diffData = buffer.diffData;
    if (diffData && !("files" in diffData)) {
      return getDiffFileName(diffData);
    }

    return displayName;
  };

  // Reset favicon error when favicon URL changes
  useEffect(() => {
    setFaviconError(false);
  }, [buffer.type === "webViewer" ? buffer.favicon : undefined]);

  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle middle click here
      if (e.button !== 1) return;

      handleTabClose(buffer.id);
    },
    [handleTabClose, buffer.id],
  );

  return (
    <div ref={tabRef} className="relative">
      {showDropIndicatorBefore ? (
        <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-accent" />
      ) : null}
      <TabBarTab
        role="tab"
        aria-selected={isActive}
        aria-label={`${buffer.name}${buffer.type === "editor" && buffer.isDirty ? " (unsaved)" : ""}${buffer.isPinned ? " (pinned)" : ""}${buffer.isPreview ? " (preview)" : ""}`}
        tabIndex={isActive ? 0 : -1}
        isActive={isActive}
        isDragged={isDraggedTab}
        onClick={isEditing ? undefined : onClick}
        onMouseDown={onMouseDown}
        onDoubleClick={isEditing ? undefined : onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onAuxClick={handleAuxClick}
        action={
          !isEditing ? (
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                if (buffer.isPinned) {
                  handleTabPin(buffer.id);
                } else {
                  handleTabClose(buffer.id);
                }
              }}
              className={cn(
                "-translate-y-1/2 absolute top-1/2 right-1 transition-opacity",
                buffer.isPinned || isActive
                  ? "opacity-100"
                  : "opacity-0 group-hover/tab:opacity-100",
              )}
              tooltip={buffer.isPinned ? "Unpin tab" : "Close"}
              shortcut={buffer.isPinned ? undefined : "mod+w"}
              tabIndex={-1}
              draggable={false}
            >
              {buffer.isPinned ? (
                <Pin className="pointer-events-none select-none fill-current text-accent" />
              ) : (
                <X className="pointer-events-none select-none" />
              )}
            </Button>
          ) : null
        }
      >
        <div className="grid size-3 shrink-0 place-content-center">
          {buffer.path === "extensions://marketplace" ? (
            <Package className="text-text-lighter" />
          ) : buffer.path.startsWith("whats-new://") ? (
            <Sparkles className="text-accent" />
          ) : buffer.type === "diff" && isMultiFileDiff(buffer.diffData) ? (
            <GitBranch className="text-text-lighter" />
          ) : buffer.type === "terminal" ? (
            <Terminal className="text-text-lighter" />
          ) : buffer.type === "agent" ? (
            <Sparkles className="text-text-lighter" />
          ) : buffer.type === "webViewer" ? (
            buffer.favicon && !faviconError ? (
              <img
                src={buffer.favicon}
                alt=""
                className="size-3 object-contain"
                onError={() => setFaviconError(true)}
              />
            ) : (
              <Globe className="text-text-lighter" />
            )
          ) : buffer.type === "database" ? (
            <Database className="text-text-lighter" />
          ) : buffer.type === "pullRequest" ? (
            authorAvatarUrl && !avatarError ? (
              <img
                src={authorAvatarUrl}
                alt=""
                className="size-3 rounded-full object-cover"
                loading="lazy"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <GitPullRequest className="text-text-lighter" />
            )
          ) : buffer.type === "githubIssue" ? (
            authorAvatarUrl && !avatarError ? (
              <img
                src={authorAvatarUrl}
                alt=""
                className="size-3 rounded-full object-cover"
                loading="lazy"
                onError={() => setAvatarError(true)}
              />
            ) : (
              <MessageSquare className="text-text-lighter" />
            )
          ) : buffer.type === "githubAction" ? (
            <Activity className="text-text-lighter" />
          ) : buffer.type === "globalSearch" ? (
            <Search className="text-text-lighter" />
          ) : buffer.type === "diagnostics" ? (
            <WarningCircle className="text-text-lighter" />
          ) : buffer.type === "references" ? (
            <Search className="text-text-lighter" />
          ) : (
            <ThemedFileIcon
              fileName={getDiffIconName() ?? buffer.name}
              isDir={false}
              className="text-text-lighter"
            />
          )}
        </div>
        {isEditing ? (
          <InlineRenameInput
            value={editingName}
            onValueChange={onEditingNameChange}
            onSubmit={onRenameSubmit}
            onCancel={onRenameCancel}
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onMouseUp={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            tone={isActive ? "default" : "muted"}
            width="content"
            className="min-w-0 max-w-full text-left"
            placeholder="Terminal name"
            aria-label={`Rename ${displayName}`}
            spellCheck={false}
          />
        ) : (
          <span
            className={cn(
              "font-sans ui-text-sm min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
              isActive ? "text-text" : "text-text-lighter",
              buffer.isPreview && "italic",
            )}
            title={buffer.path}
          >
            {displayName}
          </span>
        )}
        {buffer.type === "editor" && buffer.isDirty && (
          <div
            className="size-2 shrink-0 rounded-full bg-accent"
            title="Unsaved changes"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
      </TabBarTab>
    </div>
  );
});

function isMultiFileDiff(diffData: GitDiff | MultiFileDiff | undefined): diffData is MultiFileDiff {
  return Boolean(diffData && "files" in diffData);
}

function getDiffFileName(diff: GitDiff): string {
  const filePath = diff.new_path || diff.old_path || diff.file_path || "";
  return getBaseName(filePath, filePath || "diff");
}

export default TabBarItem;
