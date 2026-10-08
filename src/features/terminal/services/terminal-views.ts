import { lazy } from "react";
import { registerPaneView } from "@/features/panes/services/pane-view-registry";

const loadTerminalTab = () => import("../components/terminal-tab");
const TerminalTab = lazy(() =>
  loadTerminalTab().then((module) => ({ default: module.TerminalTab })),
);
const ExternalEditorBufferView = lazy(() =>
  import("../components/external-editor-terminal").then((module) => ({
    default: module.ExternalEditorBufferView,
  })),
);

function registerTerminalView() {
  registerPaneView("terminal", {
    component: TerminalTab,
    getProps: (buffer, host) => ({
      sessionId: buffer.sessionId,
      bufferId: buffer.id,
      paneId: host.paneId,
      shell: buffer.shell,
      initialCommand: buffer.initialCommand,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
      isActive: host.isActive,
      isVisible: host.isVisible,
    }),
    prefetch: loadTerminalTab,
  });
}

export function registerTerminalViews() {
  registerTerminalView();
  registerPaneView("externalEditor", {
    component: ExternalEditorBufferView,
    getProps: (buffer) => ({
      bufferId: buffer.id,
      filePath: buffer.path,
      fileName: buffer.name,
      terminalConnectionId: buffer.terminalConnectionId,
    }),
  });
}
