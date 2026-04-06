import { useCallback, useEffect, useMemo, useRef } from "react";
import AIChat from "@/features/ai/components/chat/ai-chat";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import CommandPalette from "@/features/command-palette/components/command-palette";
import IconThemeSelector from "@/features/command-palette/components/icon-theme-selector";
import ThemeSelector from "@/features/command-palette/components/theme-selector";
import { ConnectionDialog } from "@/features/database/components/connection/connection-dialog";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import type { Diagnostic } from "@/features/diagnostics/types/diagnostics";
import { ProjectNameMenu } from "@/features/file-system/components/project-name-menu";
import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useFileSystemFolderDrop } from "@/features/file-system/hooks/use-file-system-folder-drop";
import { useGitStore } from "@/features/git/stores/git-store";
import ContentGlobalSearch from "@/features/global-search/components/content-global-search";
import { SplitViewRoot } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import QuickOpen from "@/features/quick-open/components/quick-open";
import { useSettingsStore } from "@/features/settings/store";
import VimCommandBar from "@/features/vim/components/vim-command-bar";
import { useVimKeyboard } from "@/features/vim/hooks/use-vim-keyboard";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useTerminalStore } from "@/features/terminal/stores/terminal-store";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { parseDroppedPaths } from "@/features/file-system/utils/file-system-dropped-paths";
import { ExtensionDialogs } from "@/extensions/ui/components/extension-dialog";
import { frontendTrace } from "@/utils/frontend-trace";
import { VimSearchBar } from "../../vim/components/vim-search-bar";
import CustomTitleBarWithSettings from "../../window/components/custom-title-bar";
import BottomPane from "./bottom-pane/bottom-pane";
import Footer from "./footer/footer";
import { ResizablePane } from "./resizable-pane";
import { MainSidebar } from "./sidebar/main-sidebar";

const SIDEBAR_COLLAPSE_THRESHOLD = 48;

export function MainLayout() {
  useChatInitialization();
  usePaneKeyboard();

  const {
    isSidebarVisible,
    setIsSidebarVisible,
    isThemeSelectorVisible,
    setIsThemeSelectorVisible,
    isIconThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
    isDatabaseConnectionVisible,
    setIsDatabaseConnectionVisible,
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const handleOpenFolderByPath = useFileSystemStore.use.handleOpenFolderByPath?.();
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);
  const setWorkspaceGitStatus = useGitStore((state) => state.actions.setWorkspaceGitStatus);

  const hasRestoredWorkspace = useRef(false);
  const { isDraggingOver } = useFileSystemFolderDrop(async (paths) => {
    if (!paths || paths.length === 0) return;

    const droppedPaths = parseDroppedPaths(paths);
    if (droppedPaths.length === 0) return;

    try {
      const info = await getSymlinkInfo(droppedPaths[0]);
      if (info?.is_dir) {
        if (handleOpenFolderByPath) {
          await handleOpenFolderByPath(droppedPaths[0]);
        }
        return;
      }

      if (handleFileOpen) {
        for (const p of droppedPaths) {
          try {
            const pInfo = await getSymlinkInfo(p);
            if (!pInfo?.is_dir) {
              await handleFileOpen(p, false);
            }
          } catch (e) {
            console.error("Failed to open dropped path:", p, e);
          }
        }
      }
    } catch (error) {
      console.error("Error handling drag-and-drop:", error);
    }
  });

  const diagnosticsByFile = useDiagnosticsStore.use.diagnosticsByFile();
  const diagnostics = useMemo(() => {
    const allDiagnostics: Diagnostic[] = [];
    diagnosticsByFile.forEach((fileDiagnostics) => {
      allDiagnostics.push(...fileDiagnostics);
    });
    return allDiagnostics;
  }, [diagnosticsByFile]);
  const sidebarPosition = settings.sidebarPosition;
  const terminalWidthMode = useTerminalStore((state) => state.widthMode);
  const showInlineAiChat = settings.isAIChatVisible;

  useEffect(() => {
    if (settings.vimRelativeLineNumbers !== relativeLineNumbers) {
      setRelativeLineNumbers(settings.vimRelativeLineNumbers, {
        persist: false,
      });
    }
  }, [settings.vimRelativeLineNumbers, relativeLineNumbers, setRelativeLineNumbers]);

  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme);
  };

  const handleIconThemeChange = (iconTheme: string) => {
    updateSetting("iconTheme", iconTheme);
  };

  const handleDiagnosticClick = useCallback(
    (diagnostic: Diagnostic) => {
      if (handleFileSelect && diagnostic.filePath) {
        void handleFileSelect(
          diagnostic.filePath,
          false,
          diagnostic.line + 1,
          diagnostic.column + 1,
          undefined,
          false,
        );
        return;
      }

      window.dispatchEvent(
        new CustomEvent("menu-go-to-line", {
          detail: { line: diagnostic.line + 1 },
        }),
      );
    },
    [handleFileSelect],
  );

  // Initialize event listeners
  useMenuEventsWrapper();

  // Initialize vim mode handling
  useVimKeyboard({
    onSave: () => {
      // Dispatch the same save event that existing keyboard shortcuts use
      window.dispatchEvent(new CustomEvent("menu-save"));
    },
    onGoToLine: (line: number) => {
      // Dispatch go to line event
      window.dispatchEvent(
        new CustomEvent("menu-go-to-line", {
          detail: { line },
        }),
      );
    },
  });

  // Restore workspace on app startup
  useEffect(() => {
    if (hasRestoredWorkspace.current) return;

    const restoreWorkspace = async () => {
      // Get the active project tab from persisted state
      const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
      frontendTrace("info", "workspace-open", "startupRestore:checked", {
        hasActiveTab: !!activeTab,
        tabPath: activeTab?.path ?? null,
      });

      if (activeTab && switchToProject && setIsSwitchingProject) {
        hasRestoredWorkspace.current = true;
        frontendTrace("info", "workspace-open", "startupRestore:start", {
          tabPath: activeTab.path,
        });

        // Set flag BEFORE calling switchToProject to prevent tab bar from hiding
        setIsSwitchingProject(true);

        try {
          await switchToProject(activeTab.id);
          frontendTrace("info", "workspace-open", "startupRestore:end", {
            tabPath: activeTab.path,
          });
        } catch (error) {
          console.error("Failed to restore workspace:", error);
          frontendTrace("error", "workspace-open", "startupRestore:error", {
            tabPath: activeTab.path,
          });
          // Make sure to clear the flag even if restoration fails
          setIsSwitchingProject(false);
        }
      }
    };

    restoreWorkspace();
  }, [switchToProject, setIsSwitchingProject]);

  useEffect(() => {
    if (!rootFolderPath) {
      setWorkspaceGitStatus(null, null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const refreshGitState = (event?: Event) => {
      const filePath =
        event instanceof CustomEvent && typeof event.detail?.filePath === "string"
          ? event.detail.filePath
          : null;

      if (filePath && !filePath.startsWith(rootFolderPath)) {
        return;
      }

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void refreshWorkspaceGitStatus(rootFolderPath);
      }, 300);
    };

    window.addEventListener("git-status-updated", refreshGitState);
    window.addEventListener("git-status-changed", refreshGitState);

    return () => {
      window.removeEventListener("git-status-updated", refreshGitState);
      window.removeEventListener("git-status-changed", refreshGitState);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [rootFolderPath, refreshWorkspaceGitStatus, setWorkspaceGitStatus]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-secondary-bg">
      {/* Drag-and-drop overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary-bg/90 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-accent border-dashed bg-secondary-bg px-8 py-6">
            <p className="font-medium text-text text-xl">
              Drop folder to open project, or file to open buffer
            </p>
          </div>
        </div>
      )}

      <CustomTitleBarWithSettings />

      <div className="relative z-10 flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-row overflow-hidden" style={{ minHeight: 0 }}>
          {/* Left sidebar or AI chat based on settings */}
          {sidebarPosition === "right" ? (
            <div className={!showInlineAiChat ? "hidden" : undefined}>
              <ResizablePane
                position="left"
                widthKey="aiChatWidth"
                collapsible
                collapseThreshold={0}
                onCollapse={() => updateSetting("isAIChatVisible", false)}
              >
                <AIChat mode="chat" />
              </ResizablePane>
            </div>
          ) : (
            sidebarPosition === "left" && (
              <ResizablePane
                position="left"
                widthKey="sidebarWidth"
                hidden={!isSidebarVisible}
                collapsible
                collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLD}
                onCollapse={() => setIsSidebarVisible(false)}
              >
                <MainSidebar />
              </ResizablePane>
            )
          )}

          {/* Main content area with split view */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 px-2">
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-primary-bg">
              <SplitViewRoot />
            </div>
            {terminalWidthMode === "editor" && (
              <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
            )}
          </div>

          {/* Right sidebar or AI chat based on settings */}
          {sidebarPosition === "right" ? (
            <ResizablePane
              position="right"
              widthKey="sidebarWidth"
              hidden={!isSidebarVisible}
              collapsible
              collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLD}
              onCollapse={() => setIsSidebarVisible(false)}
            >
              <MainSidebar />
            </ResizablePane>
          ) : (
            <div className={!showInlineAiChat ? "hidden" : undefined}>
              <ResizablePane
                position="right"
                widthKey="aiChatWidth"
                collapsible
                collapseThreshold={0}
                onCollapse={() => updateSetting("isAIChatVisible", false)}
              >
                <AIChat mode="chat" />
              </ResizablePane>
            </div>
          )}
        </div>

        {terminalWidthMode === "full" && (
          <div className="px-2">
            <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
          </div>
        )}
      </div>

      <Footer />

      {/* Global modals and overlays */}
      <QuickOpen />
      <ContentGlobalSearch />
      <VimCommandBar />
      <VimSearchBar />
      <CommandPalette />
      <ProjectNameMenu />

      {/* Dialog components */}
      <ThemeSelector
        isVisible={isThemeSelectorVisible}
        onClose={() => setIsThemeSelectorVisible(false)}
        onThemeChange={handleThemeChange}
        currentTheme={settings.theme}
      />
      <IconThemeSelector
        isVisible={isIconThemeSelectorVisible}
        onClose={() => setIsIconThemeSelectorVisible(false)}
        onThemeChange={handleIconThemeChange}
        currentTheme={settings.iconTheme}
      />
      <ConnectionDialog
        isOpen={isDatabaseConnectionVisible}
        onClose={() => setIsDatabaseConnectionVisible(false)}
      />
      <ExtensionDialogs />
    </div>
  );
}
