import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { emitAppEvent } from "@/utils/app-events";

function openDebuggerPane() {
  const state = useUIState.getState();
  state.setBottomPaneActiveTab("debugger");
  state.setIsBottomPaneVisible(true);
}

function getActiveDebugFile() {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.actions.getActiveBuffer();
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
  openDebuggerPane();
  requestAnimationFrame(() => emitAppEvent("debugger-start"));
}

export function stopDebugSession() {
  openDebuggerPane();
  requestAnimationFrame(() => emitAppEvent("debugger-stop"));
}

export function restartDebugSession() {
  openDebuggerPane();
  requestAnimationFrame(() => emitAppEvent("debugger-restart"));
}
