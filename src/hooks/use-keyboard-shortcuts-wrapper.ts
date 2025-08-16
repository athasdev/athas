import { useSettingsStore } from "@/settings/store";
import { useAppStore } from "../stores/app-store";
import { useBufferStore } from "../stores/buffer-store";
import { useUIState } from "../stores/ui-state-store";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";

export function useKeyboardShortcutsWrapper() {
  const uiState = useUIState();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const { closeBuffer, switchToNextBuffer, switchToPreviousBuffer, setActiveBuffer } =
    useBufferStore.use.actions();
  const { handleSave, openQuickEdit } = useAppStore.use.actions();
  const { settings, updateSetting } = useSettingsStore();

  const searchViewRef = { current: null }; // Placeholder for search view ref
  const commandPaletteRef = { current: null }; // Placeholder for command palette ref

  useKeyboardShortcuts({
    setIsBottomPaneVisible: (value) => {
      if (typeof value === "function") {
        uiState.setIsBottomPaneVisible(value(uiState.isBottomPaneVisible));
      } else {
        uiState.setIsBottomPaneVisible(value);
      }
    },
    setBottomPaneActiveTab: uiState.setBottomPaneActiveTab,
    setIsFindVisible: (value) => {
      if (typeof value === "function") {
        uiState.setIsFindVisible(value(uiState.isFindVisible));
      } else {
        uiState.setIsFindVisible(value);
      }
    },
    setIsSidebarVisible: (value) => {
      if (typeof value === "function") {
        uiState.setIsSidebarVisible(value(uiState.isSidebarVisible));
      } else {
        uiState.setIsSidebarVisible(value);
      }
    },
    setIsRightPaneVisible: (value) => {
      if (typeof value === "function") {
        updateSetting("isAIChatVisible", value(settings.isAIChatVisible));
      } else {
        updateSetting("isAIChatVisible", value);
      }
    },
    setIsCommandBarVisible: (value) => {
      if (typeof value === "function") {
        uiState.setIsCommandBarVisible(value(uiState.isCommandBarVisible));
      } else {
        uiState.setIsCommandBarVisible(value);
      }
    },
    setIsCommandPaletteVisible: (value) => {
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
    focusTerminal: () => {
      // Use the centralized focus management
      uiState.requestTerminalFocus();
    },
    requestTerminalFocus: uiState.requestTerminalFocus,
    activeBuffer,
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    buffers,
    setActiveBuffer,
    isBottomPaneVisible: uiState.isBottomPaneVisible,
    bottomPaneActiveTab: uiState.bottomPaneActiveTab,
    onSave: handleSave,
    onQuickEdit: () => {
      const selection = window.getSelection();
      if (selection?.toString()) {
        openQuickEdit({
          text: selection.toString(),
          cursorPosition: { x: 0, y: 0 },
          selectionRange: { start: 0, end: selection.toString().length },
        });
      }
    },
    coreFeatures: settings.coreFeatures,
  });
}
