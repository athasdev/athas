import { browserTabManager } from "@/features/browser/services/browser-tab-manager";
import { useDockLayoutStore } from "@/features/layout/stores/dock-layout.store";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import {
  getSessionBrowserPageId,
  getSessionDockOwner,
  getSessionTerminalId,
  selectSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";

function currentSessionTerminalId(chatId: string) {
  const { terminalGeneration } = selectSessionPanel(useSessionPanelStore.getState(), chatId);
  return getSessionTerminalId(chatId, terminalGeneration);
}

function releaseTerminal(terminalId: string) {
  for (const store of useTerminalStore.getAllStores()) {
    const { actions } = store.getState();
    const session = actions.getSession(terminalId);
    if (!session) continue;
    if (session.connectionId) {
      void closeTerminalConnection(session).catch((error) =>
        console.error("Failed to close the session terminal:", error),
      );
    }
    actions.removeSession(terminalId);
  }
}

/**
 * Closes the native page and the shell a session's tools hold, once its tab closes. Switching
 * sessions or projects keeps them, and so does a terminal moved into its own editor tab; which
 * tool was open stays remembered for when the session reopens.
 */
export function releaseSessionPanelResources(chatId: string) {
  browserTabManager.close(getSessionBrowserPageId(chatId));
  releaseTerminal(currentSessionTerminalId(chatId));
}

/**
 * The session's shell exited on its own, as after `exit`: its Terminal pane closes, and opening
 * Terminal again starts a fresh shell. A terminal already moved into an editor tab is not the
 * session's any more, and its tab handles the exit.
 */
export function closeExitedSessionTerminal(chatId: string, terminalId: string) {
  if (terminalId !== currentSessionTerminalId(chatId)) return;
  useDockLayoutStore.getState().actions.close(getSessionDockOwner(chatId), "terminal");
  releaseTerminal(terminalId);
}
