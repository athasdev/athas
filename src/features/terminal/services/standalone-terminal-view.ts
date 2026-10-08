import { registerPaneView } from "@/features/panes/services/pane-view-registry";
import { TerminalTab } from "../components/terminal-tab";

/**
 * The terminal view of a standalone terminal window. The window exists to show the terminal, so
 * the view loads with the window instead of on demand.
 */
export function registerStandaloneTerminalView() {
  registerPaneView("terminal", {
    component: TerminalTab,
    getProps: (buffer) => ({
      sessionId: buffer.sessionId,
      bufferId: buffer.id,
      shell: buffer.shell,
      initialCommand: buffer.initialCommand,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
    }),
  });
}
