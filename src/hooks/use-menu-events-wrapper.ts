import { useFileSystemStore } from "../file-system/controllers/store";
import { useSettingsStore } from "../settings/store";
import { useAppStore } from "../stores/app-store";
import { useBufferStore } from "../stores/buffer-store";
import { useUIState } from "../stores/ui-state-store";
import { useMenuEvents } from "./use-menu-events";

export function useMenuEventsWrapper() {
  const uiState = useUIState();
  const fileSystemStore = useFileSystemStore();
  const { settings, updateSetting } = useSettingsStore();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { closeBuffer, switchToNextBuffer, switchToPreviousBuffer } = useBufferStore.use.actions();
  const { handleSave } = useAppStore.use.actions();

  useMenuEvents({
    onNewFile: fileSystemStore.handleCreateNewFile,
    onOpenFolder: fileSystemStore.handleOpenFolder,
    onSave: handleSave,
    onSaveAs: () => console.log("Save As not implemented"),
    onCloseTab: () => {
      if (activeBuffer) {
        closeBuffer(activeBuffer.id);
      }
    },
    onUndo: () => console.log("Undo not implemented"),
    onRedo: () => console.log("Redo not implemented"),
    onFind: () => uiState.setIsFindVisible(true),
    onFindReplace: () => console.log("Find/Replace not implemented"),
    onCommandPalette: () => uiState.setIsCommandPaletteVisible(true),
    onToggleSidebar: () => uiState.setIsSidebarVisible(!uiState.isSidebarVisible),
    onToggleTerminal: () => {
      const showingTerminal =
        !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "terminal";
      uiState.setBottomPaneActiveTab("terminal");
      uiState.setIsBottomPaneVisible(showingTerminal);

      // Request terminal focus after showing
      if (showingTerminal) {
        setTimeout(() => {
          uiState.requestTerminalFocus();
        }, 100);
      }
    },
    onToggleAiChat: () => updateSetting("isAIChatVisible", !settings.isAIChatVisible),
    onSplitEditor: () => console.log("Split Editor not implemented"),
    onToggleVim: () => console.log("Toggle Vim not implemented"),
    onGoToFile: () => uiState.setIsCommandBarVisible(true),
    onGoToLine: () => console.log("Go to Line not implemented"),
    onNextTab: switchToNextBuffer,
    onPrevTab: switchToPreviousBuffer,
    onThemeChange: (theme: string) => updateSetting("theme", theme),
    onAbout: () => console.log("About not implemented"),
    onHelp: () => console.log("Help not implemented"),
  });
}
