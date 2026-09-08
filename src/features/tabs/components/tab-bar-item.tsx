import {
  ActivityIcon,
  ArrowsClockwiseIcon,
  ChatBubbleTextIcon,
  DatabaseIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  GridIcon,
  PackageIcon,
  PinIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
  XIcon,
} from "@/ui/icons";
import { memo, useCallback, useEffect, useState } from "react";
import type { RefCallback } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { shouldShowTabCloseButton } from "@/features/settings/lib/ui-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { TabItem } from "@/ui/tab-bar";
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
  const [avatarError, setAvatarError] = useState(false);
  const showTabIcons = useSettingsStore((state) => state.settings.showTabIcons);
  const tabCloseButtonVisibility = useSettingsStore(
    (state) => state.settings.tabCloseButtonVisibility,
  );
  const showCloseButton = shouldShowTabCloseButton(
    tabCloseButtonVisibility,
    isActive,
    buffer.isPinned,
  );
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
        <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-primary" />
      ) : null}
      <TabItem
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
              iconOnly
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
                showCloseButton ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
              tooltip={buffer.isPinned ? "Unpin tab" : "Close"}
              commandId={buffer.isPinned ? undefined : "file.close"}
              tabIndex={-1}
              draggable={false}
            >
              {buffer.isPinned ? (
                <PinIcon className="pointer-events-none select-none fill-current text-primary" />
              ) : (
                <XIcon className="pointer-events-none select-none" />
              )}
            </Button>
          ) : null
        }
      >
        {showTabIcons && buffer.type !== "newTab" ? (
          <div className="grid size-3 shrink-0 place-content-center">
            {buffer.type === "extension" ? (
              <PackageIcon className="text-subtle-foreground" />
            ) : buffer.type === "diff" && isMultiFileDiff(buffer.diffData) ? (
              <GitBranchIcon className="text-subtle-foreground" />
            ) : buffer.type === "terminal" ? (
              <TerminalWindowIcon className="text-subtle-foreground" />
            ) : buffer.type === "agent" ? (
              <SparkleIcon className="text-subtle-foreground" />
            ) : buffer.type === "database" ? (
              <DatabaseIcon className="text-subtle-foreground" />
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
                <GitPullRequestIcon className="text-subtle-foreground" />
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
                <ChatBubbleTextIcon className="text-subtle-foreground" />
              )
            ) : buffer.type === "githubAction" ? (
              <ActivityIcon className="text-subtle-foreground" />
            ) : buffer.type === "githubForm" ? (
              buffer.formKind === "pull-request" ? (
                <GitPullRequestIcon className="text-subtle-foreground" />
              ) : buffer.formKind === "issue" ? (
                <ChatBubbleTextIcon className="text-subtle-foreground" />
              ) : (
                <ActivityIcon className="text-subtle-foreground" />
              )
            ) : buffer.type === "customView" ? (
              <GridIcon className="text-subtle-foreground" />
            ) : buffer.type === "globalSearch" ? (
              <SearchIcon className="text-subtle-foreground" />
            ) : buffer.type === "diagnostics" ? (
              <WarningCircleIcon className="text-subtle-foreground" />
            ) : buffer.type === "references" ? (
              <SearchIcon className="text-subtle-foreground" />
            ) : buffer.type === "continuousAgents" ? (
              <ArrowsClockwiseIcon className="text-subtle-foreground" />
            ) : buffer.type === "workspaces" ? (
              <GridIcon />
            ) : buffer.type === "settings" ? (
              <SettingsIcon className="text-subtle-foreground" />
            ) : (
              <ThemedFileIcon
                fileName={getDiffIconName() ?? buffer.name}
                isDir={false}
                className="text-subtle-foreground"
              />
            )}
          </div>
        ) : null}
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
            placeholder="Terminal name"
            aria-label={`Rename ${displayName}`}
            spellCheck={false}
          />
        ) : (
          <span
            className={cn(
              "font-sans ui-text-chrome min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
              isActive ? "text-foreground" : "text-subtle-foreground",
              buffer.isPreview && "italic",
            )}
            title={buffer.path}
          >
            {displayName}
          </span>
        )}
        {buffer.type === "editor" && buffer.isDirty && (
          <div
            className="size-2 shrink-0 rounded-full bg-primary"
            title="Unsaved changes"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
      </TabItem>
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
