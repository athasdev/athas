import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { openLocalHistoryForActiveFile } from "@/features/local-history/utils/open-local-history";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { requestWindowClose } from "@/features/window/utils/request-window-close";
import { useKeymapStore } from "../stores/keymaps.store";

function isTerminalFocused(): boolean {
  return useKeymapStore.getState().contexts.terminalFocus === true;
}

export function showNewTab(): void {
  if (isTerminalFocused()) return;
  useBufferStore.getState().actions.showNewTabView();
}

export async function saveActiveFile(): Promise<void> {
  await useEditorAppStore.getState().actions.handleSave();
}

export async function saveActiveFileAs(): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);

  if (!activeBuffer || (activeBuffer.type === "editor" && activeBuffer.readOnly)) return;

  const result = await save({
    title: "Save As",
    defaultPath: activeBuffer.name,
    filters: [
      { name: "All Files", extensions: ["*"] },
      {
        name: "Text Files",
        extensions: ["txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html"],
      },
    ],
  });

  if (result) {
    await invoke("write_file", {
      path: result,
      contents: activeBuffer.type === "editor" ? activeBuffer.content : "",
    });
  }
}

export async function saveAllFiles(): Promise<void> {
  await useEditorAppStore.getState().actions.handleSaveAll();
}

export async function revertActiveFile(): Promise<void> {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
  if (
    !activeBuffer ||
    activeBuffer.type !== "editor" ||
    activeBuffer.isVirtual ||
    activeBuffer.path.startsWith("remote://")
  ) {
    return;
  }

  await bufferStore.actions.reloadBufferFromDisk(activeBuffer.id);
}

export function closeActiveTab(): void {
  if (isTerminalFocused()) return;

  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
  if (activeBuffer) {
    bufferStore.actions.closeBuffer(activeBuffer.id);
    return;
  }

  requestWindowClose();
}

export function closeCurrentWindow(): void {
  requestWindowClose();
}

export function closeAllTabs(): void {
  useBufferStore.getState().actions.handleCloseAllTabs();
}

export function closeOtherTabs(): void {
  const bufferStore = useBufferStore.getState();
  if (!bufferStore.activeBufferId) return;

  bufferStore.actions.handleCloseOtherTabs(bufferStore.activeBufferId);
}

export function closeSavedTabs(): void {
  useBufferStore.getState().actions.handleCloseSavedTabs();
}

export function closeTabsToLeft(): void {
  const bufferStore = useBufferStore.getState();
  if (!bufferStore.activeBufferId) return;

  bufferStore.actions.handleCloseTabsToLeft(bufferStore.activeBufferId);
}

export function closeTabsToRight(): void {
  const bufferStore = useBufferStore.getState();
  if (!bufferStore.activeBufferId) return;

  bufferStore.actions.handleCloseTabsToRight(bufferStore.activeBufferId);
}

export async function reopenClosedTab(): Promise<void> {
  await useBufferStore.getState().actions.reopenClosedTab();
}

export function createNewFile(): void {
  if (isTerminalFocused()) return;

  useFileSystemStore.getState().handleCreateNewFile();
}

export function openProjectPicker(): void {
  useUIState.getState().setIsProjectPickerVisible(true);
}

export function openQuickOpen(): void {
  useUIState.getState().setIsQuickOpenVisible(true);
}

export { openLocalHistoryForActiveFile };
