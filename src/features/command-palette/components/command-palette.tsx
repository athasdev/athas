import { appDataDir } from "@tauri-apps/api/path";
import {
  ClockCounterClockwiseIcon as History,
  PuzzlePieceIcon as Puzzle,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import { IconThemeSelectorContent } from "@/features/command-palette/components/icon-theme-selector";
import { ThemeSelectorContent } from "@/features/command-palette/components/theme-selector";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { QuickQuestionCommandContent } from "@/features/ai/components/quick-question-command";
import { useLspStore } from "@/features/editor/lsp/stores/lsp.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isMarkdownFile } from "@/features/editor/utils/lines";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { LocalHistoryCommandContent } from "@/features/local-history/components/local-history-command";
import { OutlineCommandContent } from "@/features/outline/components/outline-command";
import { commitChanges } from "@/features/git/api/git-commits-api";
import { fetchChanges, pullChanges, pushChanges } from "@/features/git/api/git-remotes-api";
import {
  discardAllChanges,
  stageAllFiles,
  unstageAllFiles,
} from "@/features/git/api/git-status-api";
import { useGitStore } from "@/features/git/stores/git.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useWhatsNewStore } from "@/features/settings/stores/whats-new.store";
import { vimCommands } from "@/features/vim/stores/vim-commands";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { useEditorAppStore } from "@/features/editor/stores/editor-app.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useZoomStore } from "@/features/window/stores/zoom.store";
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
import { createGenerateActions } from "../constants/generate-actions";
import { createGitActions } from "../constants/git-actions";
import { createGitHubActions } from "../constants/github-actions";
import { createMarkdownActions } from "../constants/markdown-actions";
import { createNavigationActions } from "../constants/navigation-actions";
import { createPaneActions } from "../constants/pane-actions";
import { createSettingsActions } from "../constants/settings-actions";
import { createViewActions } from "../constants/view-actions";
import { createWindowActions } from "../constants/window-actions";
import type { Action } from "../types/action.types";
import type { CommandPaletteViewId } from "../types/view.types";
import { useActionsStore } from "../stores/action-history.store";
import { useCommandPaletteViews } from "../services/command-palette-view-registry";

interface CommandPaletteContentProps {
  commandPaletteInitialView: CommandPaletteViewId;
}

const CommandPaletteContent = ({ commandPaletteInitialView }: CommandPaletteContentProps) => {
  // Get data from stores
  const {
    setIsCommandPaletteVisible,
    setIsSettingsDialogVisible,
    isSidebarVisible,
    setIsSidebarVisible,
    isBottomPaneVisible,
    setIsBottomPaneVisible,
    bottomPaneActiveTab,
    setBottomPaneActiveTab,
    isFindVisible,
    setIsFindVisible,
    setActiveView,
    setActiveRightSidebarView,
    setIsQuickOpenVisible,
    openCommandPaletteView,
    setIsRightSidebarVisible,
    openSettingsDialog,
  } = useUIState();
  const { openQuickEdit } = useEditorAppStore.use.actions();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const onClose = () => {
    setIsCommandPaletteVisible(false);
    setViewStack(["root"]);
  };

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewStack, setViewStack] = useState<CommandPaletteViewId[]>(["root"]);
  const [activeInitialView, setActiveInitialView] = useState<CommandPaletteViewId>("root");
  const resultsRef = useRef<HTMLDivElement>(null);
  const initialViewStack = useMemo<CommandPaletteViewId[]>(
    () => (commandPaletteInitialView === "root" ? ["root"] : ["root", commandPaletteInitialView]),
    [commandPaletteInitialView],
  );
  const renderedViewStack =
    activeInitialView !== commandPaletteInitialView ? initialViewStack : viewStack;
  const currentView = renderedViewStack[renderedViewStack.length - 1] || "root";
  const isRootView = currentView === "root";

  const pushView = (view: CommandPaletteViewId) => {
    setQuery("");
    setSelectedIndex(0);
    setViewStack((currentStack) => [...currentStack, view]);
  };

  const popView = () => {
    setViewStack((currentStack) =>
      currentStack.length > 1 ? currentStack.slice(0, -1) : currentStack,
    );
  };

  const handleThemeChange = useCallback((theme: string) => {
    const { settings, updateSetting } = useSettingsStore.getState();
    if (settings.syncSystemTheme) {
      void updateSetting("syncSystemTheme", false).then(() => updateSetting("theme", theme));
      return;
    }

    void updateSetting("theme", theme);
  }, []);

  const handleIconThemeChange = useCallback((iconTheme: string) => {
    void useSettingsStore.getState().updateSetting("iconTheme", iconTheme);
  }, []);

  const lastEnteredActions = useActionsStore.use.lastEnteredActionsStack();
  const pushAction = useActionsStore.use.pushAction();
  const { settings } = useSettingsStore();
  const effectiveTheme = useEditorSettingsStore.use.theme();
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const { rootFolderPath } = useFileSystemStore();
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const gitStore = useGitStore();
  const { checkAuth: checkGitHubAuth } = useGitHubStore().actions;
  const extensionCommands = useUIExtensionStore.use.commands();
  const extensionViews = useCommandPaletteViews();
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

  const isActiveMarkdownFile = activeBuffer ? isMarkdownFile(activeBuffer.path) : false;

  // Create all actions using factory functions
  const allActions: Action[] = [
    ...createMarkdownActions({
      isMarkdownFile: isActiveMarkdownFile,
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
        webViewerEnabled: settings.coreFeatures.webViewer,
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
      pushPaletteView: pushView,
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
      setIsBottomPaneVisible,
      setBottomPaneActiveTab,
      setIsQuickOpenVisible,
      openCommandPaletteView,
      openSettingsDialog,
      coreFeatures: settings.coreFeatures,
      onClose,
    }),
    ...createPaneActions({
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
    ...createGenerateActions({
      onClose,
    }),
    ...Array.from(extensionCommands.values()).map(
      (command): Action => ({
        id: `extension-command:${command.id}`,
        label: command.title,
        description: command.category
          ? `${command.category} extension command`
          : "Installed extension command",
        icon: <Puzzle />,
        category: command.category ?? "Extensions",
        action: () => {
          onClose();
          void Promise.resolve(command.execute()).catch((error) => {
            showToast({
              message: error instanceof Error ? error.message : "Extension command failed",
              type: "error",
            });
          });
        },
      }),
    ),
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
      openDatabaseSidebar: () => {
        setActiveRightSidebarView("databases");
        setIsRightSidebarVisible(true);
      },
    }),
    ...createAdvancedActions({
      lspStatus,
      vimMode: settings.vimMode,
      vimCommands,
      setMode,
      openQuickEdit,
      pushPaletteView: pushView,
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
    if (!isRootView) return;

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
  }, [isRootView, selectedIndex, prioritizedActions, pushAction]);

  // Reset state when visibility changes
  useEffect(() => {
    setQuery("");
    setSelectedIndex(0);
    setActiveInitialView(commandPaletteInitialView);
    setViewStack(initialViewStack);
  }, [commandPaletteInitialView, initialViewStack]);

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

  const extensionView = extensionViews.get(currentView);

  return (
    <Command isVisible onClose={onClose}>
      {currentView === "quick-question" ? (
        <QuickQuestionCommandContent
          onBack={popView}
          onClose={onClose}
          activeBuffer={activeBuffer}
          buffers={buffers}
          projectRoot={rootFolderPath}
        />
      ) : currentView === "color-theme" ? (
        <ThemeSelectorContent
          isActive={currentView === "color-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleThemeChange}
          currentTheme={settings.syncSystemTheme ? effectiveTheme : settings.theme}
        />
      ) : currentView === "icon-theme" ? (
        <IconThemeSelectorContent
          isActive={currentView === "icon-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleIconThemeChange}
          currentTheme={settings.iconTheme}
        />
      ) : currentView === "local-history" ? (
        <LocalHistoryCommandContent
          isActive={currentView === "local-history"}
          activeFilePath={
            activeBuffer?.type === "editor" && !activeBuffer.isVirtual ? activeBuffer.path : null
          }
          onBack={popView}
          onClose={onClose}
        />
      ) : currentView === "outline" ? (
        <OutlineCommandContent
          isActive={currentView === "outline"}
          onBack={popView}
          onClose={onClose}
        />
      ) : extensionView ? (
        extensionView.render({
          isActive: true,
          onBack: popView,
          onClose,
        })
      ) : (
        <>
          <CommandHeader
            onClose={onClose}
            showClearButton={settings.coreFeatures.persistentCommands}
          >
            <CommandInput value={query} onChange={setQuery} placeholder="Type a command..." />
          </CommandHeader>

          <CommandList ref={resultsRef}>
            {filteredActions.length === 0 ? (
              <CommandEmpty>No commands found</CommandEmpty>
            ) : (
              prioritizedActions.map((action, index) => {
                const isRecent =
                  settings.coreFeatures.persistentCommands &&
                  lastEnteredActions.includes(action.id);
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
                      <div className="truncate ui-text-xs">{action.label}</div>
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
        </>
      )}
    </Command>
  );
};

const CommandPalette = () => {
  const isVisible = useUIState((state) => state.isCommandPaletteVisible);
  const commandPaletteInitialView = useUIState((state) => state.commandPaletteInitialView);

  if (!isVisible) return null;

  return <CommandPaletteContent commandPaletteInitialView={commandPaletteInitialView} />;
};

CommandPaletteContent.displayName = "CommandPaletteContent";
CommandPalette.displayName = "CommandPalette";

export default CommandPalette;
