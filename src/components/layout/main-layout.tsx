import { lazy, Suspense, useEffect, useState } from "react";
import SQLiteViewer from "@/database/sqlite-viewer";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { ProjectNameMenu } from "@/hooks/use-context-menus";
import { useKeyboardShortcutsWrapper } from "@/hooks/use-keyboard-shortcuts-wrapper";
import { useMenuEventsWrapper } from "@/hooks/use-menu-events-wrapper";
import { useVimKeyboard } from "@/hooks/use-vim-keyboard";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useTerminalStore } from "@/stores/terminal-store";
import { useUIState } from "@/stores/ui-state-store";
import { useVimStore } from "@/stores/vim-store";
import DiffViewer from "@/version-control/diff-viewer/views/diff-viewer";
import { stageHunk, unstageHunk } from "@/version-control/git/controllers/git";
import type { GitHunk } from "@/version-control/git/models/git-types";

// Lazy load AI Chat for better performance
const AIChat = lazy(() => import("../ai-chat/ai-chat"));

import CommandPalette from "@/features/command-palette/components/command-palette";
import IconThemeSelector from "@/features/command-palette/components/icon-theme-selector";
import ThemeSelector from "@/features/command-palette/components/theme-selector";
import ContentGlobalSearch from "@/features/global-search/components/content-global-search";
import TabBar from "@/features/tabs/components/tab-bar";
import VimCommandBar from "@/features/vim/components/vim-command-bar";
import BottomPane from "../bottom-pane";
import CommandBar from "../command-bar/components/command-bar";
import type { Diagnostic } from "../diagnostics/diagnostics-pane";
import CodeEditor from "../editor/code-editor";
import EditorFooter from "../editor-footer";
import ExtensionsView from "../extensions-view";
import GitHubCopilotSettings from "../github-copilot-settings";
import { ImageViewer } from "../image-viewer/image-viewer";
import ResizableRightPane from "../resizable-right-pane";
import ResizableSidebar from "../resizable-sidebar/resizable-sidebar";
import { VimSearchBar } from "../vim-search/vim-search-bar";
import CustomTitleBarWithSettings from "../window/custom-title-bar";
import { MainSidebar } from "./main-sidebar";

export function MainLayout() {
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
  const { rootFolderPath } = useFileSystemStore();

  const [diagnostics] = useState<Diagnostic[]>([]);
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-primary-bg">
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
                    Loading AI Chat...
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
                return <ImageViewer filePath={activeBuffer.path} fileName={activeBuffer.name} />;
              } else if (activeBuffer.isSQLite) {
                return <SQLiteViewer databasePath={activeBuffer.path} />;
              } else if (activeBuffer.path === "extensions://marketplace") {
                return (
                  <ExtensionsView
                    onServerInstall={(server) => console.log("Install server:", server)}
                    onServerUninstall={(serverId) => console.log("Uninstall server:", serverId)}
                    onThemeChange={handleThemeChange}
                    currentTheme={settings.theme}
                  />
                );
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
        {terminalWidthMode === "editor" && <BottomPane diagnostics={diagnostics} />}
      </div>

      {/* BottomPane in full width mode - covers entire window including sidebars */}
      {terminalWidthMode === "full" && <BottomPane diagnostics={diagnostics} />}

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
