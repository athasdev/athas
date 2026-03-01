import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AIChat from "@/features/ai/components/chat/ai-chat";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import CommandBar from "@/features/command-bar/components/command-bar";
import CommandPalette from "@/features/command-palette/components/command-palette";
import IconThemeSelector from "@/features/command-palette/components/icon-theme-selector";
import ThemeSelector from "@/features/command-palette/components/theme-selector";
import type { Diagnostic } from "@/features/diagnostics/diagnostics-pane";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import { ProjectNameMenu } from "@/features/file-system/components/project-name-menu";
import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import ContentGlobalSearch from "@/features/global-search/components/content-global-search";
import { SplitViewRoot } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import { useSettingsStore } from "@/features/settings/store";
import { GlobalNewTabMenu } from "@/features/tabs/components/global-new-tab-menu";
import VimCommandBar from "@/features/vim/components/vim-command-bar";
import { useVimKeyboard } from "@/features/vim/hooks/use-vim-keyboard";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useFolderDrop } from "@/hooks/use-folder-drop";
import { useUIState } from "@/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import { VimSearchBar } from "../../vim/components/vim-search-bar";
import CustomTitleBarWithSettings from "../../window/custom-title-bar";
import BottomPane from "./bottom-pane/bottom-pane";
import EditorFooter from "./footer/editor-footer";
import { ResizablePane } from "./resizable-pane";
import { MainSidebar } from "./sidebar/main-sidebar";

const AI_CHAT_OVERLAY_BREAKPOINT = 1180;

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
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const handleOpenFolderByPath = useFileSystemStore.use.handleOpenFolderByPath?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();

  const hasRestoredWorkspace = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1440,
  );

  const { isDraggingOver } = useFolderDrop(async (paths) => {
    if (!paths || paths.length === 0) return;

    try {
      const info = await getSymlinkInfo(paths[0]);
      if (info?.is_dir) {
        if (handleOpenFolderByPath) {
          await handleOpenFolderByPath(paths[0]);
        }
        return;
      }

      if (handleFileOpen) {
        for (const p of paths) {
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
  const isCompactAiOverlay = viewportWidth < AI_CHAT_OVERLAY_BREAKPOINT;
  const showInlineAiChat = settings.isAIChatVisible && !isCompactAiOverlay;
  const showOverlayAiChat = settings.isAIChatVisible && isCompactAiOverlay;
  const aiOverlaySide = sidebarPosition === "right" ? "left" : "right";

  useEffect(() => {
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!showOverlayAiChat) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        updateSetting("isAIChatVisible", false);
      }
    };

    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [showOverlayAiChat, updateSetting]);

  useEffect(() => {
    if (settings.vimRelativeLineNumbers !== relativeLineNumbers) {
      setRelativeLineNumbers(settings.vimRelativeLineNumbers, { persist: false });
    }
  }, [settings.vimRelativeLineNumbers, relativeLineNumbers, setRelativeLineNumbers]);

  const handleThemeChange = (theme: string) => {
    updateSetting("theme", theme);
  };

  const handleIconThemeChange = (iconTheme: string) => {
    updateSetting("iconTheme", iconTheme);
  };

  const handleDiagnosticClick = useCallback((diagnostic: Diagnostic) => {
    window.dispatchEvent(
      new CustomEvent("menu-go-to-line", {
        detail: { line: diagnostic.line + 1 },
      }),
    );
  }, []);

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
              <div className={!isSidebarVisible ? "hidden" : undefined}>
                <ResizablePane
                  position="left"
                  widthKey="sidebarWidth"
                  collapsible
                  collapseThreshold={0}
                  onCollapse={() => setIsSidebarVisible(false)}
                >
                  <MainSidebar />
                </ResizablePane>
              </div>
            )
          )}

          {/* Main content area with split view */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 py-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary-bg">
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <SplitViewRoot />
              </div>
              <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
            </div>
          </div>

          {/* Right sidebar or AI chat based on settings */}
          {sidebarPosition === "right" ? (
            <div className={!isSidebarVisible ? "hidden" : undefined}>
              <ResizablePane
                position="right"
                widthKey="sidebarWidth"
                collapsible
                collapseThreshold={0}
                onCollapse={() => setIsSidebarVisible(false)}
              >
                <MainSidebar />
              </ResizablePane>
            </div>
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

        {showOverlayAiChat && (
          <>
            <button
              type="button"
              className="absolute inset-0 z-[10015] bg-black/30 backdrop-blur-[1px]"
              onClick={() => updateSetting("isAIChatVisible", false)}
              aria-label="Close AI chat overlay"
            />

            <div
              className={`absolute top-2 bottom-2 z-[10020] w-[min(460px,calc(100vw-16px))] overflow-hidden rounded-2xl border border-border bg-secondary-bg shadow-2xl ${
                aiOverlaySide === "right" ? "right-2" : "left-2"
              }`}
            >
              <button
                type="button"
                onClick={() => updateSetting("isAIChatVisible", false)}
                className="absolute top-2 right-2 z-[10030] flex h-7 w-7 items-center justify-center rounded-full border border-border bg-primary-bg/90 text-text-lighter transition-colors hover:bg-hover hover:text-text"
                aria-label="Close AI chat"
              >
                <X size={14} />
              </button>
              <AIChat mode="chat" className="h-full" />
            </div>
          </>
        )}
      </div>

      <EditorFooter />

      {/* Global modals and overlays */}
      <CommandBar />
      <ContentGlobalSearch />
      <VimCommandBar />
      <VimSearchBar />
      <CommandPalette />
      <ProjectNameMenu />
      <GlobalNewTabMenu />

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
