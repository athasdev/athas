import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { requestWindowClose } from "@/features/window/utils/request-window-close";
import { emitAppEvent } from "@/utils/app-events";
import { useKeymapStore } from "../stores/keymaps.store";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

function isTerminalFocused(): boolean {
  return useKeymapStore.getState().contexts.terminalFocus === true;
}

export function showNewTab(): void {
  if (isTerminalFocused()) {
    emitAppEvent("terminal-new");
    return;
  }
  useBufferStore.getState().actions.showNewTabView();
}

export async function saveActiveFile(): Promise<void> {
  await useEditorAppStore.getState().actions.handleSave();
}

export async function saveActiveFileAs(): Promise<void> {
  await useEditorAppStore.getState().actions.handleSaveAs();
}

export async function saveAllFiles(): Promise<void> {
  await useEditorAppStore.getState().actions.handleSaveAll();
}

export async function revertActiveFile(): Promise<void> {
  const bufferStore = useBufferStore.getState();
  const activeBuffer = bufferStore.actions.getActiveBuffer();
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

/** The tab shown in the focused pane, falling back to the last active tab. */
function getActivePaneBufferId(): string | null {
  return useBufferStore.getState().actions.getActiveBuffer()?.id ?? null;
}

export function closeActiveTab(): void {
  if (isTerminalFocused()) {
    emitAppEvent("close-active-terminal");
    return;
  }

  const bufferId = getActivePaneBufferId();
  if (bufferId) {
    useBufferStore.getState().actions.closeBuffer(bufferId);
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

/** Tab commands act on the active tab, or on the tab named by `{ bufferId }` (tab context menu). */
function getTargetBufferId(args: unknown): string | null {
  if (
    typeof args === "object" &&
    args !== null &&
    "bufferId" in args &&
    typeof args.bufferId === "string"
  ) {
    return args.bufferId;
  }

  return getActiveBufferId();
}

export function closeOtherTabs(args?: unknown): void {
  const bufferId = getTargetBufferId(args);
  if (!bufferId) return;

  useBufferStore.getState().actions.handleCloseOtherTabs(bufferId);
}

export function closeSavedTabs(): void {
  useBufferStore.getState().actions.handleCloseSavedTabs();
}

export function closeTabsToLeft(args?: unknown): void {
  const bufferId = getTargetBufferId(args);
  if (!bufferId) return;

  useBufferStore.getState().actions.handleCloseTabsToLeft(bufferId);
}

export function closeTabsToRight(args?: unknown): void {
  const bufferId = getTargetBufferId(args);
  if (!bufferId) return;

  useBufferStore.getState().actions.handleCloseTabsToRight(bufferId);
}

export async function reopenClosedTab(): Promise<void> {
  await useBufferStore.getState().actions.reopenClosedTab();
}

export function createNewFile(): void {
  if (isTerminalFocused()) {
    emitAppEvent("terminal-new");
    return;
  }

  useFileSystemStore.getState().handleCreateNewFile();
}

/** The native folder dialog the File menu's "Open Folder" item shows. */
export async function openFolderDialog(): Promise<void> {
  await useFileSystemStore.getState().handleOpenFolder();
}

export function openProjectPicker(): void {
  useUIState.getState().openProjectPicker();
}

export function openQuickOpen(): void {
  useUIState.getState().setIsQuickOpenVisible(true);
}
