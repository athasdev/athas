import { isDirtyContent } from "@/features/panes/types/pane-content.types";
import { AgentAttentionDot } from "@/features/ai/components/agent-attention-dot";
import { useChatAttention } from "@/features/ai/hooks/use-chat-attention";
import { PinIcon, XIcon } from "@/ui/icons";
import { memo, useCallback } from "react";
import type { RefCallback } from "react";
import { BufferTypeIcon } from "./buffer-type-icon";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { shouldShowTabCloseButton } from "@/features/settings/lib/ui-preferences";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { InlineRenameInput } from "@/ui/input";
import { TabItem } from "@/ui/tab-bar";
import { cn } from "@/utils/cn";

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
  const agentAttention = useChatAttention(buffer.type === "agent" ? buffer.sessionId : null);
  const showTabIcons = useSettingsStore((state) => state.settings.showTabIcons);
  const tabCloseButtonVisibility = useSettingsStore(
    (state) => state.settings.tabCloseButtonVisibility,
  );
  const showCloseButton = shouldShowTabCloseButton(
    tabCloseButtonVisibility,
    isActive,
    buffer.isPinned,
  );
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
        aria-label={`${buffer.name}${isDirtyContent(buffer) ? " (unsaved)" : ""}${buffer.isPinned ? " (pinned)" : ""}${buffer.isPreview ? " (preview)" : ""}`}
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
                  if (buffer.isPinned) {
                    handleTabPin(buffer.id);
                  } else {
                    handleTabClose(buffer.id);
                  }
                }}
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
              buffer.isPreview && "italic",
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
        {agentAttention ? <AgentAttentionDot attention={agentAttention} /> : null}
      </TabItem>
    </div>
  );
});

export default TabBarItem;
