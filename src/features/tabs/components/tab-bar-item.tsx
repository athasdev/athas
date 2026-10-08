import { isDirtyContent } from "@/features/panes/types/pane-content.types";
import { getTabDecoration } from "../services/tab-decoration-registry";
import { PinIcon, XIcon } from "@/ui/icons";
import { memo, useCallback } from "react";
import type { RefCallback } from "react";
import { BufferTypeIcon } from "./buffer-type-icon";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { shouldShowTabCloseButton } from "@/features/settings/services/ui-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { TabItem } from "@/ui/tab-bar";
import { cn } from "@/utils/cn";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";

interface TabBarItemProps {
  buffer: PaneContent;
  displayName: string;
  index: number;
  isActive: boolean;
  isPinned?: boolean;
  isPreview?: boolean;
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
  isPinned = false,
  isPreview = false,
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
  const TabIndicator = getTabDecoration(buffer.type)?.indicator;
  const closeShortcut = useCommandShortcut(isPinned ? undefined : "file.close");
  const showTabIcons = useSettingsStore((state) => state.settings.showTabIcons);
  const tabCloseButtonVisibility = useSettingsStore(
    (state) => state.settings.tabCloseButtonVisibility,
  );
  const showCloseButton = shouldShowTabCloseButton(tabCloseButtonVisibility, isActive, isPinned);
  const handleAuxClick = useCallback(
    (e: React.MouseEvent) => {
      // Only handle middle click here
      if (e.button !== 1) return;

      handleTabClose(buffer.id);
    },
    [handleTabClose, buffer.id],
  );

  return (
    <div ref={tabRef} className="relative flex">
      {showDropIndicatorBefore ? (
        <div className="drop-indicator absolute top-1 bottom-1 left-0 z-20 w-0.5 bg-primary" />
      ) : null}
      <TabItem
        role="tab"
        aria-selected={isActive}
        aria-label={`${buffer.name}${isDirtyContent(buffer) ? " (unsaved)" : ""}${isPinned ? " (pinned)" : ""}${isPreview ? " (preview)" : ""}`}
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
            <span
              className={cn(
                "inline-flex -translate-y-1/2 absolute top-1/2 right-1 transition-opacity focus-within:opacity-100",
                showCloseButton ? "opacity-100" : "opacity-0 group-hover/tab:opacity-100",
              )}
            >
              <Button
                type="button"
                iconOnly
                size="xs"
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPinned) {
                    handleTabPin(buffer.id);
                  } else {
                    handleTabClose(buffer.id);
                  }
                }}
                tooltip={isPinned ? "Unpin tab" : "Close"}
                shortcut={closeShortcut}
                tabIndex={-1}
                draggable={false}
              >
                {isPinned ? (
                  <PinIcon className="pointer-events-none select-none fill-current text-primary" />
                ) : (
                  <XIcon className="pointer-events-none select-none" />
                )}
              </Button>
            </span>
          ) : null
        }
      >
        {showTabIcons && buffer.type !== "newTab" ? (
          <div className="grid size-3 shrink-0 place-content-center">
            <BufferTypeIcon buffer={buffer} displayName={displayName} />
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
              isPreview && "italic",
            )}
            title={buffer.path}
          >
            {displayName}
          </span>
        )}
        {isDirtyContent(buffer) && (
          <div
            className="size-2 shrink-0 rounded-full bg-primary"
            title="Unsaved changes"
            role="img"
            aria-label="Unsaved changes"
          />
        )}
        {TabIndicator ? <TabIndicator buffer={buffer} /> : null}
      </TabItem>
    </div>
  );
});

export default TabBarItem;
