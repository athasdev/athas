import { appDataDir } from "@tauri-apps/api/path";
import { useEffect, useRef, useState } from "react";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/store";
import {
  commitChanges,
  discardAllChanges,
  fetchChanges,
  pullChanges,
  pushChanges,
  stageAllFiles,
  unstageAllFiles,
} from "@/features/version-control/git/controllers/git";
import { useGitStore } from "@/features/version-control/git/controllers/git-store";
import { vimCommands } from "@/features/vim/stores/vim-commands";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useAppStore } from "@/stores/app-store";
import { useUIState } from "@/stores/ui-state-store";
import { useZoomStore } from "@/stores/zoom-store";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import KeybindingBadge from "@/ui/keybinding-badge";
import { createAdvancedActions } from "../constants/advanced-actions";
import { createFileActions } from "../constants/file-actions";
import { createGitActions } from "../constants/git-actions";
import { createNavigationActions } from "../constants/navigation-actions";
import { createSettingsActions } from "../constants/settings-actions";
import { createViewActions } from "../constants/view-actions";
import { createWindowActions } from "../constants/window-actions";
import type { Action } from "../models/action.types";

const CommandPalette = () => {
  // Get data from stores
  const {
    isCommandPaletteVisible,
    setIsCommandPaletteVisible,
    setIsSettingsDialogVisible,
    setIsThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
    isSidebarVisible,
    setIsSidebarVisible,
    isBottomPaneVisible,
    setIsBottomPaneVisible,
    bottomPaneActiveTab,
    setBottomPaneActiveTab,
    isFindVisible,
    setIsFindVisible,
    setActiveView,
    setIsCommandBarVisible,
    setIsGlobalSearchVisible,
    setIsBranchManagerVisible,
  } = useUIState();
  const { openQuickEdit } = useAppStore.use.actions();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const { settings } = useSettingsStore();
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const { clearLspError, updateLspStatus } = useLspStore.use.actions();
  const { rootFolderPath } = useFileSystemStore();
  const gitStore = useGitStore();
  const { showToast } = useToast();
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const {
    closeBuffer,
    setActiveBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reopenClosedTab,
  } = useBufferStore.use.actions();
  const { zoomIn, zoomOut, resetZoom } = useZoomStore.use.actions();

  // Create all actions using factory functions
  const allActions: Action[] = [
    ...createViewActions({
      isSidebarVisible,
      setIsSidebarVisible,
      isBottomPaneVisible,
      setIsBottomPaneVisible,
      bottomPaneActiveTab,
      setBottomPaneActiveTab,
      isFindVisible,
      setIsFindVisible,
      settings: {
        isAIChatVisible: settings.isAIChatVisible,
        sidebarPosition: settings.sidebarPosition,
        nativeMenuBar: settings.nativeMenuBar,
        compactMenuBar: settings.compactMenuBar,
      },
      updateSetting: useSettingsStore.getState().updateSetting as (
        key: string,
        value: any,
      ) => void | Promise<void>,
      zoomIn,
      zoomOut,
      resetZoom,
      onClose,
    }),
    ...createSettingsActions({
      settings,
      setIsSettingsDialogVisible,
      setIsThemeSelectorVisible,
      setIsIconThemeSelectorVisible,
      updateSetting: useSettingsStore.getState().updateSetting as (
        key: string,
        value: any,
      ) => void | Promise<void>,
      handleFileSelect,
      getAppDataDir: appDataDir,
      onClose,
    }),
    ...createNavigationActions({
      setIsSidebarVisible,
      setActiveView,
      setIsCommandBarVisible,
      setIsGlobalSearchVisible,
      onClose,
    }),
    ...createFileActions({
      activeBufferId,
      buffers,
      closeBuffer,
      switchToNextBuffer,
      switchToPreviousBuffer,
      setActiveBuffer,
      reopenClosedTab,
      onClose,
    }),
    ...createWindowActions({
      onClose,
    }),
    ...createGitActions({
      rootFolderPath,
      showToast,
      gitStore,
      gitOperations: {
        stageAllFiles,
        unstageAllFiles,
        commitChanges,
        pushChanges,
        pullChanges,
        fetchChanges,
        discardAllChanges,
      },
      setIsBranchManagerVisible,
      onClose,
    }),
    ...createAdvancedActions({
      lspStatus,
      updateLspStatus: updateLspStatus as (
        status: string,
        workspaces?: string[],
        error?: string,
      ) => void,
      clearLspError,
      rootFolderPath,
      vimMode: settings.vimMode,
      vimCommands,
      setMode,
      openQuickEdit,
      showToast,
      onClose,
    }),
  ];

  // Filter actions based on query
  const filteredActions = allActions.filter(
    (action) =>
      action.label.toLowerCase().includes(query.toLowerCase()) ||
      action.description?.toLowerCase().includes(query.toLowerCase()) ||
      action.category.toLowerCase().includes(query.toLowerCase()),
  );

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < filteredActions.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (filteredActions[selectedIndex]) {
            filteredActions[selectedIndex].action();
          }
          break;
        // Escape is now handled globally in use-keyboard-shortcuts
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, filteredActions, selectedIndex]);

  // Reset state when visibility changes
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      });
    }
  }, [isVisible]);

  // Update selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current && filteredActions.length > 0) {
      const selectedElement = resultsRef.current.children[selectedIndex] as HTMLElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      }
    }
  }, [selectedIndex, filteredActions.length]);

  if (!isVisible) return null;

  return (
    <Command isVisible={isVisible} onClose={onClose}>
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Type a command..."
        />
      </CommandHeader>

      <CommandList ref={resultsRef}>
        {filteredActions.length === 0 ? (
          <CommandEmpty>No commands found</CommandEmpty>
        ) : (
          filteredActions.map((action, index) => (
            <CommandItem
              key={action.id}
              onClick={() => {
                action.action();
              }}
              isSelected={index === selectedIndex}
              className="px-3 py-1.5"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs">{action.label}</div>
              </div>
              {action.keybinding && (
                <div className="flex-shrink-0">
                  <KeybindingBadge keys={action.keybinding} />
                </div>
              )}
            </CommandItem>
          ))
        )}
      </CommandList>
    </Command>
  );
};

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
