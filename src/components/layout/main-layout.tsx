import { lazy, Suspense, useState } from "react";
import SQLiteViewer from "@/database/sqlite-viewer";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { ProjectNameMenu } from "@/hooks/use-context-menus";
import { useKeyboardShortcutsWrapper } from "@/hooks/use-keyboard-shortcuts-wrapper";
import { useMenuEventsWrapper } from "@/hooks/use-menu-events-wrapper";
import { useVimKeyboard } from "@/hooks/use-vim-keyboard";
import { useSettingsStore } from "@/settings/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useUIState } from "@/stores/ui-state-store";
import DiffViewer from "@/version-control/diff-viewer/views/diff-viewer";
import { stageHunk, unstageHunk } from "@/version-control/git/controllers/git";
import type { GitHunk } from "@/version-control/git/models/git-types";

// Lazy load AI Chat for better performance
const AIChat = lazy(() => import("../ai-chat/ai-chat"));

import BottomPane from "../bottom-pane";
import CommandBar from "../command/components/command-bar";
import CommandPalette from "../command/components/command-palette";
import ThemeSelector from "../command/components/theme-selector";
import VimCommandBar from "../command/components/vim-command-bar";
import type { Diagnostic } from "../diagnostics/diagnostics-pane";
import CodeEditor from "../editor/code-editor";
import EditorFooter from "../editor-footer";
import ExtensionsView from "../extensions-view";
import FileReloadToast from "../file-reload-toast";
import GitHubCopilotSettings from "../github-copilot-settings";
import { ImageViewer } from "../image-viewer/image-viewer";
import ResizableRightPane from "../resizable-right-pane";
import ResizableSidebar from "../resizable-sidebar/resizable-sidebar";
import TabBar from "../tab-bar/tab-bar";
import { VimSearchBar } from "../vim-search/vim-search-bar";
import CustomTitleBarWithSettings from "../window/custom-title-bar";
import { MainSidebar } from "./main-sidebar";

export function MainLayout() {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId) || null;

  const { isSidebarVisible, isThemeSelectorVisible, setIsThemeSelectorVisible } = useUIState();
  const { settings, updateSetting } = useSettingsStore();
  const { rootFolderPath } = useFileSystemStore();

  const [diagnostics] = useState<Diagnostic[]>([]);
  const sidebarPosition = settings.sidebarPosition;

  // Handle theme change
  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme);
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
        <div className="flex flex-1 flex-row overflow-hidden">
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

        <BottomPane diagnostics={diagnostics} />
      </div>

      <EditorFooter />

      {/* Global modals and overlays */}
      <CommandBar />
      <VimCommandBar />
      <VimSearchBar />
      <CommandPalette />
      <GitHubCopilotSettings />
      <ProjectNameMenu />
      <FileReloadToast />

      {/* Dialog components */}
      <ThemeSelector
        isVisible={isThemeSelectorVisible}
        onClose={() => setIsThemeSelectorVisible(false)}
        onThemeChange={handleThemeChange}
        currentTheme={settings.theme}
      />
    </div>
  );
}
