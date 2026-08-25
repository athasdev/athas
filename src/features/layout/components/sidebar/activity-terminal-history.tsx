import { useCallback, useState } from "react";
import { useActivitySidebarSection } from "@/features/layout/hooks/use-activity-sidebar-section";
import {
  useActivityTerminalItems,
  type ActivityTerminalItem,
} from "@/features/layout/hooks/use-activity-terminal-items";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  PencilSimpleLineIcon,
  PlusIcon,
  PushPinIcon,
  PushPinSlashIcon,
  TerminalIcon,
  XIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
  SidebarSectionHeader,
  SidebarSectionStack,
} from "@/ui/sidebar";

export function ActivityTerminalRow({
  name,
  active,
  pinned,
  onOpen,
  onRename,
  onPinChange,
  onClose,
}: ActivityTerminalItem) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(name);

  if (isRenaming) {
    return (
      <SidebarListEditor appearance="activity" leading={<TerminalIcon />}>
        <InlineRenameInput
          className="select-text"
          value={renameValue}
          onValueChange={setRenameValue}
          onSubmit={(nextName) => {
            if (nextName !== name) onRename(nextName);
            setIsRenaming(false);
          }}
          onCancel={() => setIsRenaming(false)}
          aria-label={`Rename ${name}`}
        />
      </SidebarListEditor>
    );
  }

  return (
    <SidebarListActionRow
      actions={[
        <SidebarIconButton
          key="rename"
          tooltip="Rename terminal"
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            setRenameValue(name);
            setIsRenaming(true);
          }}
        >
          <PencilSimpleLineIcon />
        </SidebarIconButton>,
        <SidebarIconButton
          key="pin"
          active={pinned}
          aria-pressed={pinned}
          tooltip={pinned ? "Unpin terminal" : "Pin terminal"}
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            onPinChange();
          }}
        >
          {pinned ? <PushPinSlashIcon /> : <PushPinIcon />}
        </SidebarIconButton>,
        <SidebarIconButton
          key="close"
          tone="danger"
          tooltip="Close terminal"
          tooltipSide="right"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <XIcon />
        </SidebarIconButton>,
      ]}
    >
      <SidebarListItem
        active={active}
        appearance="activity"
        leading={<TerminalIcon />}
        onClick={onOpen}
      >
        {name}
      </SidebarListItem>
    </SidebarListActionRow>
  );
}

export function ActivityTerminalHistory() {
  const { isCollapsed, toggleCollapsed } = useActivitySidebarSection("terminals");
  const terminalItems = useActivityTerminalItems({ pinned: false });

  const handleNewTerminal = useCallback(() => {
    const uiState = useUIState.getState();
    uiState.setBottomPaneActiveTab("terminal");
    uiState.setIsBottomPaneVisible(true);
    window.dispatchEvent(new CustomEvent("terminal-new"));
  }, []);

  return (
    <SidebarSectionStack>
      <SidebarSectionHeader
        expanded={!isCollapsed}
        onToggle={toggleCollapsed}
        action={
          terminalItems.length > 0 ? (
            <SidebarIconButton
              tooltip="New Terminal"
              tooltipSide="right"
              commandId="terminal.new"
              aria-label="New Terminal"
              onClick={handleNewTerminal}
            >
              <PlusIcon />
            </SidebarIconButton>
          ) : undefined
        }
      >
        Terminals
      </SidebarSectionHeader>
      {!isCollapsed ? (
        <>
          {terminalItems.length === 0 ? (
            <SidebarListItem
              appearance="activity"
              leading={<TerminalIcon />}
              aria-label="New Terminal"
              onClick={handleNewTerminal}
            >
              New Terminal
            </SidebarListItem>
          ) : null}
          {terminalItems.map((terminal) => (
            <ActivityTerminalRow key={terminal.id} {...terminal} />
          ))}
        </>
      ) : null}
    </SidebarSectionStack>
  );
}
