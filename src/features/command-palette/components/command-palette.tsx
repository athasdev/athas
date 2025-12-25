import { appDataDir } from "@tauri-apps/api/path";
import { History, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useGitStore } from "@/features/version-control/git/controllers/store";
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
import { cn } from "@/utils/cn";
import { createAdvancedActions } from "../constants/advanced-actions";
import { createFileActions } from "../constants/file-actions";
import { createGitActions } from "../constants/git-actions";
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
    setIsCommandBarVisible,
    setIsGlobalSearchVisible,
    setIsBranchManagerVisible,
    openSettingsDialog,
  } = useUIState();
  const { openQuickEdit } = useAppStore.use.actions();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const isVisible = isCommandPaletteVisible;
  const onClose = () => setIsCommandPaletteVisible(false);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const scrollAnimationRef = useRef<number | null>(null);

  const lastEnteredActions = useActionsStore.use.lastEnteredActionsStack();
  const pushAction = useActionsStore.use.pushAction();
  const favoriteActions = useActionsStore.use.favoritedActions();
  const toggleFavoriteAction = useActionsStore.use.toggleFavoriteAction();
  const [actionsFavoritedThisSession, setActionsFavoritedThisSession] = useState<string[]>([
    ...favoriteActions,
  ]);

  const { settings } = useSettingsStore();
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const { clearLspError, updateLspStatus } = useLspStore.use.actions();
  const { rootFolderPath } = useFileSystemStore();
  const gitStore = useGitStore();
  const { showToast } = useToast();
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

  const prioritizedActions = useMemo(() => {
    if (!filteredActions) return [];

    const actionMap = new Map(filteredActions.map((a) => [a.id, a]));

    // FAVORITES (always first)
    const favorited = favoriteActions
      .map((id) => actionMap.get(id))
      .filter((a): a is Action => !!a);

    // Persistent off → favorites first, then the rest
    if (!settings.coreFeatures.persistentCommands) {
      const remaining = filteredActions.filter((a) => !favoriteActions.includes(a.id));
      return [...favorited, ...remaining];
    }

    // Persistent on → lastEnteredActions should come AFTER favorites,
    // but must skip anything that's favorited.
    const prioritized = lastEnteredActions
      .filter((id) => !favoriteActions.includes(id)) // <-- FIX
      .map((id) => actionMap.get(id))
      .filter((a): a is Action => !!a);

    // Remaining items = not in favorites AND not in lastEntered
    const remaining = filteredActions.filter(
      (a) => !favoriteActions.includes(a.id) && !lastEnteredActions.includes(a.id),
    );

    return [...favorited, ...prioritized, ...remaining];
  }, [
    filteredActions,
    lastEnteredActions,
    favoriteActions,
    settings.coreFeatures.persistentCommands,
  ]);

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
        case "Tab":
          if (e.shiftKey) {
            e.preventDefault();
            inputRef.current?.focus();
            break;
          }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isVisible, filteredActions, selectedIndex, prioritizedActions]);

  // Update selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!resultsRef.current || filteredActions.length === 0) return;

    if (scrollAnimationRef.current) cancelAnimationFrame(scrollAnimationRef.current);

    scrollAnimationRef.current = requestAnimationFrame(() => {
      const container = resultsRef.current;
      if (container) {
        // requestAnimationFrame could theorically be called after the container is removed, so an added check is important
        const selectedElement = container.children[selectedIndex] as HTMLElement;
        if (selectedElement) {
          selectedElement.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      }
    });
  }, [selectedIndex, filteredActions.length]);

  // Reset state when visibility changes
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
      scrollAnimationRef.current = null;
      setActionsFavoritedThisSession([...favoriteActions]);
    } else {
      const original = actionsFavoritedThisSession;
      const current = favoriteActions;

      const added = current.filter((id) => !original.includes(id));
      const removed = original.filter((id) => !current.includes(id));

      for (const id of added) toggleFavoriteAction(id);
      for (const id of removed) toggleFavoriteAction(id);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  const onFavoriteActionClick = (actionId: string) => {
    setActionsFavoritedThisSession((prev) => {
      if (prev.includes(actionId)) {
        return prev.filter((id) => id !== actionId);
      } else {
        return [...prev, actionId];
      }
    });
  };

  const focusSelectedIndex = (e: React.FocusEvent) => {
    // Check if the focus is coming from OUTSIDE the results list
    const isEnteringFromOutside = !resultsRef.current?.contains(e.relatedTarget as Node);

    if (isEnteringFromOutside) {
      if (prioritizedActions[selectedIndex]) {
        const elementToFocus = resultsRef.current?.children[selectedIndex] as HTMLElement;
        if (elementToFocus && document.activeElement !== elementToFocus) {
          elementToFocus.focus();
        }
      }
    }
  };

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

      <CommandList ref={resultsRef} onFocus={focusSelectedIndex}>
        {filteredActions.length === 0 ? (
          <CommandEmpty>No commands found</CommandEmpty>
        ) : (
          prioritizedActions.map((action, index) => {
            const isRecent =
              settings.coreFeatures.persistentCommands && lastEnteredActions.includes(action.id);
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
                {isRecent && <History size={12} className="shrink-0 text-text-lighter" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{action.label}</div>
                </div>
                {action.keybinding && (
                  <div className="shrink-0">
                    <KeybindingBadge keys={action.keybinding} />
                  </div>
                )}
                <button
                  aria-label="Favorite this action"
                  className="rounded p-0.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onFavoriteActionClick(action.id);
                  }}
                >
                  <Star
                    size={12}
                    className={cn(
                      "text-text-lighter hover:text-accent/75",
                      actionsFavoritedThisSession.includes(action.id) && "fill-accent",
                    )}
                  />
                </button>
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
