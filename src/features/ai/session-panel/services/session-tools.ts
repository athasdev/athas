import { useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import { getSessionDockOwner, useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";

/**
 * Opens one of a session's tools in its dock, or brings it forward when it is open. Tools the
 * user types into take focus once they show.
 */
export function openSessionTool(
  chatId: string,
  tab: SessionPanelTab,
  options: { changePath?: string; focus?: boolean } = {},
) {
  const { selectChange, clearAttention } = useSessionPanelStore.getState().actions;
  if (options.changePath) selectChange(chatId, options.changePath);
  useDockLayoutStore.getState().actions.open(getSessionDockOwner(chatId), tab, {
    focus: options.focus ?? tab === "terminal",
  });
  clearAttention(chatId, tab);
}

/** The header's tool buttons: open the tool, or close it when it is open. */
export function toggleSessionTool(chatId: string, tab: SessionPanelTab) {
  const isOpen = useDockLayoutStore
    .getState()
    .actions.toggle(getSessionDockOwner(chatId), tab, { focus: tab === "terminal" });
  if (isOpen) useSessionPanelStore.getState().actions.clearAttention(chatId, tab);
}
