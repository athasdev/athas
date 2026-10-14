import { useSessionPanelStore } from "../stores/session-panel.store";
import type { SessionPanelTab } from "../types/session-panel.types";
import { setCardOrigin } from "./card-motion";

/**
 * Opens a session's tool panel on `tab`, growing it out of `origin` (the box row the user
 * clicked) when there is one. Tools the user types into take focus once they show.
 */
export function openSessionTool(
  chatId: string,
  tab: SessionPanelTab,
  origin?: Element | null,
  options: { changePath?: string } = {},
) {
  if (origin) {
    const rect = origin.getBoundingClientRect();
    setCardOrigin(chatId, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }
  const { open, requestFocus, selectChange } = useSessionPanelStore.getState().actions;
  if (options.changePath) selectChange(chatId, options.changePath);
  if (tab === "terminal") requestFocus(chatId, "terminal");
  open(chatId, tab);
}

/** The header's tool buttons: open the tool, or close it when it is the one showing. */
export function toggleSessionTool(chatId: string, tab: SessionPanelTab) {
  const state = useSessionPanelStore.getState();
  const panel = state.panels[chatId];
  if (panel?.open && panel.tab === tab) {
    state.actions.close(chatId);
    return;
  }
  openSessionTool(chatId, tab);
}
