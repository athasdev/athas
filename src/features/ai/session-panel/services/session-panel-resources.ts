import { browserTabManager } from "@/features/browser/services/browser-tab-manager";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import {
  getSessionBrowserPageId,
  getSessionTerminalId,
  selectSessionPanel,
  useSessionPanelStore,
} from "../stores/session-panel.store";

/**
 * Closes the native page and the shell a session's tools hold, once its tab closes. Switching
 * sessions or projects keeps them, and so does a terminal moved into its own editor tab; which
 * tool was open stays remembered for when the session reopens.
 */
export function releaseSessionPanelResources(chatId: string) {
  browserTabManager.close(getSessionBrowserPageId(chatId));
  const { terminalGeneration } = selectSessionPanel(useSessionPanelStore.getState(), chatId);
  const terminalId = getSessionTerminalId(chatId, terminalGeneration);
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
