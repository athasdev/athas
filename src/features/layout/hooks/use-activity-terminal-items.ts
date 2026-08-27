import { useCallback, useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  CLOSE_TERMINAL_EVENT,
  RENAME_TERMINAL_EVENT,
} from "@/features/terminal/constants/terminal-events";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { useUIState } from "@/features/window/stores/ui-state.store";

export interface ActivityTerminalItem {
  id: string;
  name: string;
  active: boolean;
  pinned: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  onPinChange: () => void;
  onClose: () => void;
}

interface UseActivityTerminalItemsOptions {
  pinned: boolean;
  enabled?: boolean;
}

function closePanelTerminal(terminalId: string) {
  window.dispatchEvent(
    new CustomEvent(CLOSE_TERMINAL_EVENT, {
      detail: { terminalId },
    }),
  );
}

function renameTerminal(terminalId: string, name: string) {
  window.dispatchEvent(
    new CustomEvent(RENAME_TERMINAL_EVENT, {
      detail: { terminalId, name },
    }),
  );
}

export function useActivityTerminalItems({
  pinned,
  enabled = true,
}: UseActivityTerminalItemsOptions): ActivityTerminalItem[] {
  const buffers = useBufferStore((state) => state.buffers);
  const activeBufferId = useBufferStore((state) => state.activeBufferId);
  const setActiveBuffer = useBufferStore.use.actions().setActiveBuffer;
  const handleTabPin = useBufferStore.use.actions().handleTabPin;
  const handleTabClose = useBufferStore.use.actions().handleTabClose;
  const panelTerminals = useTerminalTabsStore((state) => state.terminals);
  const activePanelTerminalId = useTerminalTabsStore((state) => state.activeTerminalId);
  const dispatchTerminalAction = useTerminalTabsStore((state) => state.actions.dispatch);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);

  const openPanelTerminal = useCallback(
    (terminalId: string) => {
      dispatchTerminalAction({ type: "SET_ACTIVE_TERMINAL", payload: { id: terminalId } });
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);
    },
    [dispatchTerminalAction, setBottomPaneActiveTab, setIsBottomPaneVisible],
  );

  return useMemo(() => {
    if (!enabled) return [];

    const panelItems: ActivityTerminalItem[] = panelTerminals
      .filter((terminal) => Boolean(terminal.isPinned) === pinned)
      .map((terminal) => ({
        id: `panel-${terminal.id}`,
        name: terminal.name,
        active:
          isBottomPaneVisible &&
          bottomPaneActiveTab === "terminal" &&
          terminal.id === activePanelTerminalId,
        pinned,
        onOpen: () => openPanelTerminal(terminal.id),
        onRename: (name) => renameTerminal(terminal.id, name),
        onPinChange: () =>
          dispatchTerminalAction({
            type: "PIN_TERMINAL",
            payload: { id: terminal.id, isPinned: !pinned },
          }),
        onClose: () => closePanelTerminal(terminal.id),
      }));

    const bufferItems: ActivityTerminalItem[] = buffers.flatMap((terminal) => {
      if (terminal.type !== "terminal" || terminal.isPinned !== pinned) return [];

      return {
        id: `buffer-${terminal.id}`,
        name: terminal.name,
        active: terminal.id === activeBufferId,
        pinned,
        onOpen: () => setActiveBuffer(terminal.id),
        onRename: (name) => renameTerminal(terminal.sessionId, name),
        onPinChange: () => handleTabPin(terminal.id),
        onClose: () => handleTabClose(terminal.id),
      };
    });

    return [...panelItems, ...bufferItems];
  }, [
    activeBufferId,
    activePanelTerminalId,
    bottomPaneActiveTab,
    buffers,
    dispatchTerminalAction,
    enabled,
    handleTabClose,
    handleTabPin,
    isBottomPaneVisible,
    openPanelTerminal,
    panelTerminals,
    pinned,
    setActiveBuffer,
  ]);
}
