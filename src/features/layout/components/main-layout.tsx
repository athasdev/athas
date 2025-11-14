import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import SQLiteViewer from "@/features/database/providers/sqlite/sqlite-viewer";
import type { Diagnostic } from "@/features/diagnostics/diagnostics-pane";
import { useDiagnosticsStore } from "@/features/diagnostics/diagnostics-store";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { ProjectNameMenu } from "@/features/file-system/components/project-name-menu";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import DiffViewer from "@/features/version-control/diff-viewer/components/diff-viewer";
import { stageHunk, unstageHunk } from "@/features/version-control/git/controllers/git";
import type { GitHunk } from "@/features/version-control/git/types/git";
import { useVimKeyboard } from "@/features/vim/hooks/use-vim-keyboard";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useKeyboardShortcutsWrapper } from "@/features/window/hooks/use-keyboard-shortcuts-wrapper";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useFolderDrop } from "@/hooks/use-folder-drop";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUIState } from "@/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";

// Lazy load AI Chat for better performance
const AIChat = lazy(() => import("@/features/ai/components/chat/ai-chat"));

import GitHubCopilotSettings from "@/features/ai/components/github-copilot-settings";
import CommandBar from "@/features/command-bar/components/command-bar";
import CommandPalette from "@/features/command-palette/components/command-palette";
import IconThemeSelector from "@/features/command-palette/components/icon-theme-selector";
import ThemeSelector from "@/features/command-palette/components/theme-selector";
import CodeEditor from "@/features/editor/components/code-editor";
import ContentGlobalSearch from "@/features/global-search/components/content-global-search";
import { ImageViewer } from "@/features/image-viewer/components/image-viewer";
import TabBar from "@/features/tabs/components/tab-bar";
import VimCommandBar from "@/features/vim/components/vim-command-bar";
import { VimSearchBar } from "../../vim/components/vim-search-bar";
import CustomTitleBarWithSettings from "../../window/custom-title-bar";
import BottomPane from "./bottom-pane/bottom-pane";
import EditorFooter from "./footer/editor-footer";
import ResizableRightPane from "./right-pane/resizable-right-pane";
import { MainSidebar } from "./sidebar/main-sidebar";
import ResizableSidebar from "./sidebar/resizable-sidebar";

export function MainLayout() {
  // Initialize AI chat storage (SQLite database + migration)
  useChatInitialization();

  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;

  const {
    isSidebarVisible,
    isThemeSelectorVisible,
    setIsThemeSelectorVisible,
    isIconThemeSelectorVisible,
    setIsIconThemeSelectorVisible,
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const handleOpenFolderByPath = useFileSystemStore.use.handleOpenFolderByPath?.();
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();

  const hasRestoredWorkspace = useRef(false);

  // Handle folder drag-and-drop
  const { isDraggingOver } = useFolderDrop(async (path) => {
    if (handleOpenFolderByPath) {
      await handleOpenFolderByPath(path);
    }
  });

  const { getAllDiagnostics } = useDiagnosticsStore.use.actions();
  const diagnostics = useMemo(() => getAllDiagnostics(), [getAllDiagnostics]);
  const sidebarPosition = settings.sidebarPosition;
  const terminalWidthMode = useTerminalStore((state) => state.widthMode);

  useEffect(() => {
    if (settings.vimRelativeLineNumbers !== relativeLineNumbers) {
      setRelativeLineNumbers(settings.vimRelativeLineNumbers, { persist: false });
    }
  }, [settings.vimRelativeLineNumbers, relativeLineNumbers, setRelativeLineNumbers]);

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme);
  };

  // Handle icon theme change
  const handleIconThemeChange = (iconTheme: string) => {
    updateSetting("iconTheme", iconTheme);
  };

  // Handle hunk staging/unstaging
  const handleStageHunk = async (hunk: GitHunk) => {
    if (!rootFolderPath) {
      console.error("No rootFolderPath available");
      return;
    }

    try {
      const success = await stageHunk(rootFolderPath, hunk);
      if (success) {
        // Emit a custom event to notify Git view and DiffViewer to refresh
        window.dispatchEvent(new CustomEvent("git-status-changed"));
      } else {
        console.error("Failed to stage hunk");
      }
    } catch (error) {
      console.error("Error staging hunk:", error);
    }
  };

  const handleUnstageHunk = async (hunk: GitHunk) => {
    if (!rootFolderPath) {
      console.error("No rootFolderPath available");
      return;
    }

    try {
      const success = await unstageHunk(rootFolderPath, hunk);
      if (success) {
        // Emit a custom event to notify Git view and DiffViewer to refresh
        window.dispatchEvent(new CustomEvent("git-status-changed"));
      } else {
        console.error("Failed to unstage hunk");
      }
    } catch (error) {
      console.error("Error unstaging hunk:", error);
    }
  };

  // Handle diagnostic click - jump to diagnostic location
  const handleDiagnosticClick = useCallback((diagnostic: Diagnostic) => {
    // Dispatch go to line event with the diagnostic line number
    window.dispatchEvent(
      new CustomEvent("menu-go-to-line", {
        detail: { line: diagnostic.line + 1 }, // +1 because diagnostics are 0-indexed
      }),
    );
  }, []);

  // Initialize event listeners
  useMenuEventsWrapper();
  useKeyboardShortcutsWrapper();

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

      if (activeTab && switchToProject && setIsSwitchingProject) {
        hasRestoredWorkspace.current = true;

        // Set flag BEFORE calling switchToProject to prevent tab bar from hiding
        setIsSwitchingProject(true);

        try {
          await switchToProject(activeTab.id);
        } catch (error) {
          console.error("Failed to restore workspace:", error);
          // Make sure to clear the flag even if restoration fails
          setIsSwitchingProject(false);
        }
      }
    };

    restoreWorkspace();
  }, [switchToProject, setIsSwitchingProject]);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-primary-bg">
      {/* Drag-and-drop overlay */}
      {isDraggingOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary-bg/90 backdrop-blur-sm">
          <div className="rounded-lg border-2 border-accent border-dashed bg-secondary-bg px-8 py-6">
            <p className="font-medium text-text text-xl">Drop folder to open as project</p>
          </div>
        </div>
      )}

      <CustomTitleBarWithSettings />
      <div className="h-px flex-shrink-0 bg-border" />

      <div className="z-10 flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-row overflow-hidden" style={{ minHeight: 0 }}>
          {/* Left sidebar or AI chat based on settings */}
          {sidebarPosition === "right" ? (
            <ResizableRightPane position="left" isVisible={settings.isAIChatVisible}>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-text-lighter text-xs">
                    Loading...
                  </div>
                }
              >
                <AIChat mode="chat" />
              </Suspense>
            </ResizableRightPane>
          ) : (
            isSidebarVisible && (
              <ResizableSidebar>
                <MainSidebar />
              </ResizableSidebar>
            )
          )}

          {/* Main content area */}
          <div className="flex h-full flex-1 flex-col overflow-hidden">
            <TabBar />
            {(() => {
              if (!activeBuffer) {
                return <div className="flex flex-1 items-center justify-center"></div>;
              }
              if (activeBuffer.isDiff) {
                return (
                  <DiffViewer onStageHunk={handleStageHunk} onUnstageHunk={handleUnstageHunk} />
                );
              } else if (activeBuffer.isImage) {
                return (
                  <ImageViewer
                    filePath={activeBuffer.path}
                    fileName={activeBuffer.name}
                    bufferId={activeBuffer.id}
                  />
                );
              } else if (activeBuffer.isSQLite) {
                return <SQLiteViewer databasePath={activeBuffer.path} />;
              } else {
                return <CodeEditor />;
              }
            })()}
          </div>

          {/* Right sidebar or AI chat based on settings */}
          {sidebarPosition === "right" ? (
            isSidebarVisible && (
              <ResizableRightPane position="right">
                <MainSidebar />
              </ResizableRightPane>
            )
          ) : (
            <ResizableRightPane position="right" isVisible={settings.isAIChatVisible}>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-text-lighter text-xs">
                    Loading AI Chat...
                  </div>
                }
              >
                <AIChat mode="chat" />
              </Suspense>
            </ResizableRightPane>
          )}
        </div>

        {/* BottomPane in editor width mode - only covers middle section */}
        {terminalWidthMode === "editor" && (
          <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
        )}
      </div>

      {/* BottomPane in full width mode - covers entire window including sidebars */}
      {terminalWidthMode === "full" && (
        <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
      )}

      <EditorFooter />

      {/* Global modals and overlays */}
      <CommandBar />
      <ContentGlobalSearch />
      <VimCommandBar />
      <VimSearchBar />
      <CommandPalette />
      <GitHubCopilotSettings />
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
    </div>
  );
}
