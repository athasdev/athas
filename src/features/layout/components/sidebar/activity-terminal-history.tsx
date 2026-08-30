import { useCallback, useState } from "react";
import { ActivitySidebarSection } from "@/features/layout/components/sidebar/activity-sidebar-section";
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
  TerminalWindowIcon,
  XIcon,
} from "@/ui/icons";
import { InlineRenameInput } from "@/ui/input";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListEditor,
  SidebarListItem,
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
      <SidebarListEditor leading={<TerminalWindowIcon />}>
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
      <SidebarListItem active={active} leading={<TerminalWindowIcon />} onClick={onOpen}>
        {name}
      </SidebarListItem>
    </SidebarListActionRow>
  );
}

export function ActivityTerminalHistory() {
  const terminalItems = useActivityTerminalItems({ pinned: false });

  const handleNewTerminal = useCallback(() => {
    const uiState = useUIState.getState();
    uiState.setBottomPaneActiveTab("terminal");
    uiState.setIsBottomPaneVisible(true);
    window.dispatchEvent(new CustomEvent("terminal-new"));
  }, []);

  return (
    <ActivitySidebarSection
      id="terminals"
      title="Terminals"
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
      {terminalItems.length === 0 ? (
        <SidebarListItem
          leading={<TerminalWindowIcon />}
          aria-label="New Terminal"
          onClick={handleNewTerminal}
        >
          New Terminal
        </SidebarListItem>
      ) : null}
      {terminalItems.map((terminal) => (
        <ActivityTerminalRow key={terminal.id} {...terminal} />
      ))}
    </ActivitySidebarSection>
  );
}
