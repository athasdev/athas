import { appDataDir } from "@tauri-apps/api/path";
import { ClockCounterClockwise as History } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLspStore } from "@/features/editor/lsp/lsp-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { commitChanges } from "@/features/git/api/git-commits-api";
import { fetchChanges, pullChanges, pushChanges } from "@/features/git/api/git-remotes-api";
import {
  discardAllChanges,
  stageAllFiles,
  unstageAllFiles,
} from "@/features/git/api/git-status-api";
import { useGitStore } from "@/features/git/stores/git-store";
import { useRepositoryStore } from "@/features/git/stores/git-repository-store";
import { useGitHubStore } from "@/features/github/stores/github-store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useOnboardingStore } from "@/features/onboarding/store";
import { useSettingsStore } from "@/features/settings/store";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new-store";
import { vimCommands } from "@/features/vim/stores/vim-commands";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useZoomStore } from "@/features/window/stores/zoom-store";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/ui/command";
import Keybinding from "@/ui/keybinding";
import { matchesSearchQuery } from "@/utils/search-match";
import { createAdvancedActions } from "../constants/advanced-actions";
import { createDatabaseActions } from "../constants/database-actions";
import { createFileActions } from "../constants/file-actions";
import { createGitActions } from "../constants/git-actions";
import { createGitHubActions } from "../constants/github-actions";
import { createMarkdownActions } from "../constants/markdown-actions";
import { createNavigationActions } from "../constants/navigation-actions";
import { createSettingsActions } from "../constants/settings-actions";
import { createViewActions } from "../constants/view-actions";
import { createWindowActions } from "../constants/window-actions";
import type { Action } from "../models/action.types";
import { useActionsStore } from "../store";

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
    setIsQuickOpenVisible,
    setIsDatabaseConnectionVisible,
    openSettingsDialog,
  } = useUIState();
  const { openQuickEdit } = useEditorAppStore.use.actions();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);

  const lastEnteredActions = useActionsStore.use.lastEnteredActionsStack();
  const pushAction = useActionsStore.use.pushAction();
  const { settings } = useSettingsStore();
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const { clearLspError, updateLspStatus } = useLspStore.use.actions();
  const { rootFolderPath } = useFileSystemStore();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const gitStore = useGitStore();
  const { checkAuth: checkGitHubAuth } = useGitHubStore().actions;
  const { showToast } = useToast();
  const openWhatsNew = useWhatsNewStore((state) => state.open);
  const openOnboarding = useOnboardingStore((state) => state.openPreview);
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;
  const {
    closeBuffer,
    setActiveBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reopenClosedTab,
    openWebViewerBuffer,
  } = useBufferStore.use.actions();
  const { zoomIn, zoomOut, resetZoom } = useZoomStore.use.actions();
  const { openBuffer } = useBufferStore.use.actions();

  // Helper function to check if the active buffer is a markdown file
  const isMarkdownFile = () => {
    if (!activeBuffer) return false;
    const extension = activeBuffer.path.split(".").pop()?.toLowerCase();
    return extension === "md" || extension === "markdown";
  };

  // Create all actions using factory functions
  const allActions: Action[] = [
    ...createMarkdownActions({
      isMarkdownFile: isMarkdownFile(),
      activeBuffer,
      openBuffer,
      onClose,
    }),
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
      openWebViewerBuffer,
      onClose,
    }),
    ...createSettingsActions({
      query,
      settings,
      setIsSettingsDialogVisible,
      openSettingsDialog,
      setSettingsSearchQuery: useSettingsStore.getState().setSearchQuery,
      setIsThemeSelectorVisible,
      setIsIconThemeSelectorVisible,
      updateSetting: useSettingsStore.getState().updateSetting as (
        key: string,
        value: any,
      ) => void | Promise<void>,
      handleFileSelect,
      getAppDataDir: appDataDir,
      openWhatsNew,
      openOnboarding,
      onClose,
    }),
    ...createNavigationActions({
      setIsSidebarVisible,
      setActiveView,
      setIsQuickOpenVisible,
      openSettingsDialog,
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
      activeRepoPath,
      setIsSidebarVisible,
      setActiveView,
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
      onClose,
    }),
    ...createGitHubActions({
      setIsSidebarVisible,
      setActiveView,
      settings: {
        showGitHubPullRequests: settings.showGitHubPullRequests,
        showGitHubIssues: settings.showGitHubIssues,
        showGitHubActions: settings.showGitHubActions,
      },
      updateSetting: useSettingsStore.getState().updateSetting as (
        key: string,
        value: any,
      ) => void | Promise<void>,
      checkAuth: checkGitHubAuth,
      showToast,
      onClose,
    }),
    ...createDatabaseActions({
      onClose,
      setIsDatabaseConnectionVisible,
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
      !query.trim() ||
      matchesSearchQuery(query, [action.label, action.description ?? "", action.category]),
  );

  const prioritizedActions = useMemo(() => {
    if (!settings.coreFeatures.persistentCommands) return filteredActions;
    if (!filteredActions) return [];

    const remaining = filteredActions.filter((action) => !lastEnteredActions.includes(action.id));

    const prioritized = lastEnteredActions
      .map((id) => filteredActions.find((a) => a.id === id))
      .filter((a): a is Action => !!a); // Filter out undefined and assure it is of type Action

    return [...prioritized, ...remaining];
  }, [filteredActions, lastEnteredActions, settings.coreFeatures.persistentCommands]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev < prioritizedActions.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          e.preventDefault();
          if (prioritizedActions[selectedIndex]) {
            prioritizedActions[selectedIndex].action();
            pushAction(prioritizedActions[selectedIndex].id);
          }
          break;
        // Escape is now handled globally in use-keyboard-shortcuts
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, selectedIndex, prioritizedActions, pushAction]);

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
      <CommandHeader onClose={onClose} showClearButton={settings.coreFeatures.persistentCommands}>
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
          prioritizedActions.map((action, index) => {
            const isRecent =
              settings.coreFeatures.persistentCommands && lastEnteredActions.includes(action.id);
            const binding = action.commandId
              ? keymapRegistry.getKeybinding(action.commandId)?.key
              : undefined;
            return (
              <CommandItem
                key={action.id}
                onClick={() => {
                  action.action();
                  pushAction(action.id);
                }}
                isSelected={index === selectedIndex}
                className="px-3 py-1.5"
              >
                {isRecent && <History className="shrink-0 text-text-lighter" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{action.label}</div>
                </div>
                {binding && (
                  <div className="shrink-0">
                    <Keybinding binding={binding} />
                  </div>
                )}
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </Command>
  );
};

CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
