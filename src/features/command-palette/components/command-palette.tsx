import { appDataDir } from "@tauri-apps/api/path";
import { MagnifyingGlassIcon as Search, PuzzlePieceIcon as Puzzle } from "@/ui/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUIExtensionStore } from "@/extensions/ui/stores/ui-extension-store";
import { IconThemeSelectorContent } from "@/features/command-palette/components/icon-theme-selector";
import { ThemeSelectorContent } from "@/features/command-palette/components/theme-selector";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { DatabaseCommandContent } from "@/features/database/components/database-sidebar";
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
  CommandItemBadge,
  CommandItemRow,
  CommandList,
  CommandTabs,
  useCommandListNavigation,
} from "@/ui/command";
import { Kbd } from "@/ui/kbd";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import Keybinding from "@/features/keymaps/components/keybinding";
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
import {
  commandPaletteFilters,
  flattenCommandPaletteSections,
  getCommandPaletteSections,
  type CommandPaletteFilter,
} from "../utils/command-palette-results";
import { useActionsStore } from "../stores/action-history.store";
import { useCommandPaletteViews } from "../services/command-palette-view-registry";

interface CommandPaletteContentProps {
  commandPaletteInitialView: CommandPaletteViewId;
}

const CommandPaletteContent = ({ commandPaletteInitialView }: CommandPaletteContentProps) => {
  // Get data from stores
  const setIsCommandPaletteVisible = useUIState((state) => state.setIsCommandPaletteVisible);
  const setIsSettingsDialogVisible = useUIState((state) => state.setIsSettingsDialogVisible);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const setIsBottomPaneVisible = useUIState((state) => state.setIsBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const setBottomPaneActiveTab = useUIState((state) => state.setBottomPaneActiveTab);
  const setActiveView = useUIState((state) => state.setActiveView);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const openCommandPaletteView = useUIState((state) => state.openCommandPaletteView);
  const openSettingsDialog = useUIState((state) => state.openSettingsDialog);
  const { openQuickEdit } = useEditorAppStore.use.actions();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const onClose = () => {
    setIsCommandPaletteVisible(false);
    setViewStack(["root"]);
  };

  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<CommandPaletteFilter>("all");
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

  const pushView = (view: CommandPaletteViewId) => {
    setQuery("");
    setViewStack((currentStack) => [...currentStack, view]);
  };

  const popView = () => {
    setViewStack((currentStack) =>
      currentStack.length > 1 ? currentStack.slice(0, -1) : currentStack,
    );
  };

  const handleThemeChange = useCallback((theme: string) => {
    const { settings, actions } = useSettingsStore.getState();
    const { updateSetting } = actions;
    if (settings.syncSystemTheme) {
      void updateSetting("syncSystemTheme", false).then(() => updateSetting("theme", theme));
      return;
    }

    void updateSetting("theme", theme);
  }, []);

  const handleIconThemeChange = useCallback((iconTheme: string) => {
    void useSettingsStore.getState().actions.updateSetting("iconTheme", iconTheme);
  }, []);

  const lastEnteredActions = useActionsStore.use.lastEnteredActionsStack();
  const pushAction = useActionsStore.use.actions().pushAction;
  const activityRailExpanded = useSettingsStore((state) => state.settings.activityRailExpanded);
  const aiCompletion = useSettingsStore((state) => state.settings.aiCompletion);
  const autoCompletion = useSettingsStore((state) => state.settings.autoCompletion);
  const autoDetectLanguage = useSettingsStore((state) => state.settings.autoDetectLanguage);
  const autoSave = useSettingsStore((state) => state.settings.autoSave);
  const compactMenuBar = useSettingsStore((state) => state.settings.compactMenuBar);
  const codeLens = useSettingsStore((state) => state.settings.codeLens);
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const formatOnSave = useSettingsStore((state) => state.settings.formatOnSave);
  const iconTheme = useSettingsStore((state) => state.settings.iconTheme);
  const inlayHints = useSettingsStore((state) => state.settings.inlayHints);
  const lineNumbers = useSettingsStore((state) => state.settings.lineNumbers);
  const nativeMenuBar = useSettingsStore((state) => state.settings.nativeMenuBar);
  const parameterHints = useSettingsStore((state) => state.settings.parameterHints);
  const semanticTokens = useSettingsStore((state) => state.settings.semanticTokens);
  const showGitHubActions = useSettingsStore((state) => state.settings.showGitHubActions);
  const showGitHubIssues = useSettingsStore((state) => state.settings.showGitHubIssues);
  const showGitHubPullRequests = useSettingsStore((state) => state.settings.showGitHubPullRequests);
  const showMinimap = useSettingsStore((state) => state.settings.showMinimap);
  const syncSystemTheme = useSettingsStore((state) => state.settings.syncSystemTheme);
  const telemetry = useSettingsStore((state) => state.settings.telemetry);
  const theme = useSettingsStore((state) => state.settings.theme);
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const wordWrap = useSettingsStore((state) => state.settings.wordWrap);
  const effectiveTheme = useEditorSettingsStore.use.theme();
  const { setMode } = useVimStore.use.actions();
  const lspStatus = useLspStore.use.lspStatus();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { checkAuth: checkGitHubAuth } = useGitHubStore.use.actions();
  const extensionCommands = useUIExtensionStore.use.commands();
  const extensionViews = useCommandPaletteViews();
  const { showToast } = useToast();
  const openWhatsNew = useWhatsNewStore((state) => state.actions.open);
  const openOnboarding = useOnboardingStore((state) => state.actions.openPreview);
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = useBufferStore((state) =>
    activeBufferId ? (state.buffers.find((buffer) => buffer.id === activeBufferId) ?? null) : null,
  );
  const {
    closeBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reopenClosedTab,
    openWebViewerBuffer,
    openGitHubFormBuffer,
    openContent,
  } = useBufferStore.use.actions();
  const { zoomIn, zoomOut, resetZoom } = useZoomStore.use.actions();
  const { openBuffer } = useBufferStore.use.actions();

  const commandSettings = useMemo(
    () => ({
      activityRailExpanded,
      aiCompletion,
      autoCompletion,
      autoDetectLanguage,
      autoSave,
      compactMenuBar,
      codeLens,
      coreFeatures,
      formatOnSave,
      iconTheme,
      inlayHints,
      lineNumbers,
      nativeMenuBar,
      parameterHints,
      semanticTokens,
      showGitHubActions,
      showGitHubIssues,
      showGitHubPullRequests,
      showMinimap,
      syncSystemTheme,
      telemetry,
      theme,
      vimMode,
      vimRelativeLineNumbers,
      wordWrap,
    }),
    [
      activityRailExpanded,
      aiCompletion,
      autoCompletion,
      autoDetectLanguage,
      autoSave,
      compactMenuBar,
      codeLens,
      coreFeatures,
      formatOnSave,
      iconTheme,
      inlayHints,
      lineNumbers,
      nativeMenuBar,
      parameterHints,
      semanticTokens,
      showGitHubActions,
      showGitHubIssues,
      showGitHubPullRequests,
      showMinimap,
      syncSystemTheme,
      telemetry,
      theme,
      vimMode,
      vimRelativeLineNumbers,
      wordWrap,
    ],
  );

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
      settings: {
        activityRailExpanded: commandSettings.activityRailExpanded,
        nativeMenuBar: commandSettings.nativeMenuBar,
        compactMenuBar: commandSettings.compactMenuBar,
        webViewerEnabled: commandSettings.coreFeatures.webViewer,
      },
      updateSetting: useSettingsStore.getState().actions.updateSetting as (
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
      settings: commandSettings,
      setIsSettingsDialogVisible,
      openSettingsDialog,
      setSettingsSearchQuery: useSettingsStore.getState().actions.setSearchQuery,
      pushPaletteView: pushView,
      updateSetting: useSettingsStore.getState().actions.updateSetting as (
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
      coreFeatures: commandSettings.coreFeatures,
      hasActiveEditor: activeBuffer?.type === "editor",
      onClose,
    }),
    ...createPaneActions({
      onClose,
    }),
    ...createFileActions({
      activeBufferId,
      closeBuffer,
      switchToNextBuffer,
      switchToPreviousBuffer,
      reopenClosedTab,
      openMarkdownDocument: () => {
        openContent({ type: "markdownDocument", documentId: crypto.randomUUID() });
      },
      onClose,
    }),
    ...createGenerateActions({
      onClose,
    }),
    ...Array.from(extensionCommands.values()).map((command): Action => ({
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
    })),
    ...createWindowActions({
      onClose,
    }),
    ...createGitActions({
      rootFolderPath,
      activeRepoPath,
      setIsSidebarVisible,
      setActiveView,
      showToast,
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
      repoPath: activeRepoPath ?? rootFolderPath ?? null,
      setIsSidebarVisible,
      setActiveView,
      settings: {
        showGitHubPullRequests: commandSettings.showGitHubPullRequests,
        showGitHubIssues: commandSettings.showGitHubIssues,
        showGitHubActions: commandSettings.showGitHubActions,
      },
      updateSetting: useSettingsStore.getState().actions.updateSetting as (
        key: string,
        value: any,
      ) => void | Promise<void>,
      checkAuth: checkGitHubAuth,
      showToast,
      openGitHubFormBuffer,
      onClose,
    }),
    ...createDatabaseActions({
      openDatabaseCommand: () => pushView("databases"),
    }),
    ...createAdvancedActions({
      lspStatus,
      vimMode: commandSettings.vimMode,
      vimCommands,
      setMode,
      openQuickEdit,
      showToast,
      onClose,
    }),
  ];

  const commandSections = getCommandPaletteSections({
    actions: allActions,
    filter: activeFilter,
    query,
    recentActionIds: lastEnteredActions,
    showRecent: commandSettings.coreFeatures.persistentCommands,
  });
  const paletteActions = flattenCommandPaletteSections(commandSections);
  const actionIndexes = new Map(paletteActions.map((action, index) => [action.id, index]));

  const handleActionSelect = useCallback(
    (index: number) => {
      const action = paletteActions[index];
      if (!action) return;
      action.action();
      pushAction(action.id);
    },
    [paletteActions, pushAction],
  );

  const {
    selectedIndex,
    setSelectedIndex,
    onInputKeyDown: handleCommandKeyDown,
  } = useCommandListNavigation({
    itemCount: paletteActions.length,
    resetKey: `${currentView}:${activeFilter}:${query}`,
    onSelect: handleActionSelect,
  });

  // Reset state when visibility changes
  useEffect(() => {
    setQuery("");
    setActiveFilter("all");
    setActiveInitialView(commandPaletteInitialView);
    setViewStack(initialViewStack);
  }, [commandPaletteInitialView, initialViewStack]);

  // Scroll selected item into view
  useEffect(() => {
    const selectedElement = resultsRef.current?.querySelector(
      `[data-command-item-index="${selectedIndex}"]`,
    );
    selectedElement?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex, paletteActions.length]);

  const extensionView = extensionViews.get(currentView);

  return (
    <Command isVisible onClose={onClose}>
      {currentView === "color-theme" ? (
        <ThemeSelectorContent
          isActive={currentView === "color-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleThemeChange}
          currentTheme={commandSettings.syncSystemTheme ? effectiveTheme : commandSettings.theme}
        />
      ) : currentView === "icon-theme" ? (
        <IconThemeSelectorContent
          isActive={currentView === "icon-theme"}
          onBack={popView}
          onClose={onClose}
          onThemeChange={handleIconThemeChange}
          currentTheme={commandSettings.iconTheme}
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
      ) : currentView === "databases" ? (
        <DatabaseCommandContent
          isActive={currentView === "databases"}
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
            showClearButton={commandSettings.coreFeatures.persistentCommands}
          >
            <Search className="size-4 shrink-0 text-subtle-foreground" />
            <CommandInput
              value={query}
              onChange={setQuery}
              onKeyDown={handleCommandKeyDown}
              placeholder="Search commands and actions..."
              role="combobox"
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls="command-palette-results"
              aria-activedescendant={
                paletteActions.length ? `command-palette-option-${selectedIndex}` : undefined
              }
            />
            <Kbd>Return</Kbd>
          </CommandHeader>

          <CommandTabs
            ariaLabel="Command categories"
            items={commandPaletteFilters.map((filter) => ({
              id: filter.id,
              label: filter.label,
              isActive: filter.id === activeFilter,
              onSelect: () => setActiveFilter(filter.id),
            }))}
          />

          <CommandList
            ref={resultsRef}
            id="command-palette-results"
            role="listbox"
            aria-label="Command results"
          >
            {paletteActions.length === 0 ? (
              <CommandEmpty>No commands found</CommandEmpty>
            ) : (
              commandSections.map((section) => (
                <section key={section.id} aria-labelledby={`command-section-${section.id}`}>
                  <div
                    id={`command-section-${section.id}`}
                    className="px-2.5 pt-2 pb-1 font-medium text-subtle-foreground ui-text-chrome"
                  >
                    {section.label}
                  </div>
                  {section.actions.map((action) => {
                    const index = actionIndexes.get(action.id) ?? 0;
                    const isSelected = index === selectedIndex;
                    const isRecent =
                      commandSettings.coreFeatures.persistentCommands &&
                      lastEnteredActions.includes(action.id);
                    const binding = action.commandId
                      ? keymapRegistry.getKeybinding(action.commandId)?.key
                      : undefined;

                    return (
                      <CommandItemRow
                        key={action.id}
                        as="div"
                        id={`command-palette-option-${index}`}
                        role="option"
                        tabIndex={-1}
                        aria-selected={isSelected}
                        data-command-item-index={index}
                        onClick={() => {
                          action.action();
                          pushAction(action.id);
                        }}
                        onMouseEnter={() => setSelectedIndex(index)}
                        isSelected={isSelected}
                        icon={action.icon}
                        iconVariant="framed"
                        contentLayout="stacked"
                        title={<SearchMatchHighlight text={action.label} query={query} />}
                        description={
                          <>
                            <span>{action.category}</span>
                            <span aria-hidden="true"> · </span>
                            <SearchMatchHighlight text={action.description} query={query} />
                          </>
                        }
                        accessory={
                          <>
                            {isRecent ? <CommandItemBadge>Recent</CommandItemBadge> : null}
                            {binding ? (
                              <Keybinding binding={binding} />
                            ) : isSelected ? (
                              <Kbd>Return</Kbd>
                            ) : null}
                          </>
                        }
                      />
                    );
                  })}
                </section>
              ))
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
