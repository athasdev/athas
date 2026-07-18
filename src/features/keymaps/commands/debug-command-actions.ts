import {
  buildDebugCommand,
  createGeneratedDebugConfig,
} from "@/features/debugger/utils/debugger-command";
import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { useUIState } from "@/features/window/stores/ui-state.store";

function openDebuggerPane() {
  const state = useUIState.getState();
  state.setBottomPaneActiveTab("debugger");
  state.setIsBottomPaneVisible(true);
}

function getActiveDebugFile() {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find(
    (buffer) => buffer.id === bufferStore.activeBufferId,
  );
  if (!activeBuffer || activeBuffer.type !== "editor" || activeBuffer.isVirtual) return null;

  return {
    path: activeBuffer.path,
    name: activeBuffer.name,
    language: activeBuffer.language,
  };
}

export function toggleDebuggerPane() {
  const state = useUIState.getState();
  if (state.isBottomPaneVisible && state.bottomPaneActiveTab === "debugger") {
    state.setIsBottomPaneVisible(false);
  } else {
    openDebuggerPane();
  }
}

export function toggleActiveBreakpoint() {
  const activeFile = getActiveDebugFile();
  if (!activeFile) return;

  const line = useEditorStateStore.getState().cursorPosition.line;
  useDebuggerStore.getState().actions.toggleBreakpoint(activeFile.path, line);
}

export function startGeneratedDebugSession() {
  const rootFolderPath = useProjectStore.getState().rootFolderPath;
  const activeFile = getActiveDebugFile();
  const config = createGeneratedDebugConfig(activeFile, rootFolderPath);
  const command = buildDebugCommand(config);
  if (!command.trim()) {
    openDebuggerPane();
    return;
  }

  window.dispatchEvent(
    new CustomEvent("create-terminal-with-command", {
      detail: {
        name: config.name,
        command,
        workingDirectory: config.cwd || rootFolderPath || undefined,
      },
    }),
  );

  useDebuggerStore.getState().actions.startSession({
    id: `debug_${Date.now()}`,
    name: config.name,
    configId: config.id,
    command,
    cwd: config.cwd,
    startedAt: Date.now(),
    status: "running",
  });
}

export function stopDebugSession() {
  window.dispatchEvent(new CustomEvent("close-active-terminal"));
  useDebuggerStore.getState().actions.stopSession();
}
