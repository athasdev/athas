import { useDebuggerStore } from "@/features/debugger/stores/debugger.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
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
  dispatchDebuggerAction("debugger-start");
}

export function stopDebugSession() {
  dispatchDebuggerAction("debugger-stop");
}

export function restartDebugSession() {
  dispatchDebuggerAction("debugger-restart");
}

function dispatchDebuggerAction(action: "debugger-start" | "debugger-stop" | "debugger-restart") {
  openDebuggerPane();
  requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(action)));
}
