import { useAppStore } from "../stores/app-store";
import { useBufferStore } from "../stores/buffer-store";
import { usePersistentSettingsStore } from "../stores/persistent-settings-store";
import { useUIState } from "../stores/ui-state-store";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

export function useKeyboardShortcutsWrapper() {
  const uiState = useUIState();
  const bufferStore = useBufferStore();
  const appStore = useAppStore();
  const { coreFeatures, isAIChatVisible, setIsAIChatVisible } = usePersistentSettingsStore();

  const searchViewRef = { current: null }; // Placeholder for search view ref
  const commandPaletteRef = { current: null }; // Placeholder for command palette ref

  useKeyboardShortcuts({
    setIsBottomPaneVisible: value => {
      if (typeof value === "function") {
        uiState.setIsBottomPaneVisible(value(uiState.isBottomPaneVisible));
      } else {
        uiState.setIsBottomPaneVisible(value);
      }
    },
    setBottomPaneActiveTab: uiState.setBottomPaneActiveTab,
    setIsFindVisible: value => {
      if (typeof value === "function") {
        uiState.setIsFindVisible(value(uiState.isFindVisible));
      } else {
        uiState.setIsFindVisible(value);
      }
    },
    setIsSidebarVisible: value => {
      if (typeof value === "function") {
        uiState.setIsSidebarVisible(value(uiState.isSidebarVisible));
      } else {
        uiState.setIsSidebarVisible(value);
      }
    },
    setIsRightPaneVisible: value => {
      if (typeof value === "function") {
        setIsAIChatVisible(value(isAIChatVisible));
      } else {
        setIsAIChatVisible(value);
      }
    },
    setIsCommandBarVisible: value => {
      if (typeof value === "function") {
        uiState.setIsCommandBarVisible(value(uiState.isCommandBarVisible));
      } else {
        uiState.setIsCommandBarVisible(value);
      }
    },
    setIsCommandPaletteVisible: value => {
      if (typeof value === "function") {
        uiState.setIsCommandPaletteVisible(value(uiState.isCommandPaletteVisible));
      } else {
        uiState.setIsCommandPaletteVisible(value);
      }
    },
    setIsSearchViewActive: uiState.setIsSearchViewActive,
    focusSearchInput: () => {
      if (searchViewRef.current && "focus" in searchViewRef.current) {
        (searchViewRef.current as any).focus();
      }
    },
    focusCommandPalette: () => {
      if (commandPaletteRef.current && "focus" in commandPaletteRef.current) {
        (commandPaletteRef.current as any).focus();
      }
    },
    activeBuffer: bufferStore.getActiveBuffer(),
    closeBuffer: bufferStore.closeBuffer,
    switchToNextBuffer: bufferStore.switchToNextBuffer,
    switchToPreviousBuffer: bufferStore.switchToPreviousBuffer,
    buffers: bufferStore.buffers,
    setActiveBuffer: bufferStore.setActiveBuffer,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    onSave: appStore.handleSave,
    onQuickEdit: () => {
      const selection = window.getSelection();
      if (selection?.toString()) {
        appStore.openQuickEdit({
          text: selection.toString(),
          cursorPosition: { x: 0, y: 0 },
          selectionRange: { start: 0, end: selection.toString().length },
        });
      }
    },
    coreFeatures,
  });
}
