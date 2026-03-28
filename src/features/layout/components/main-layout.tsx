import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import CommandPalette from "@/features/command-palette/components/command-palette";
import IconThemeSelector from "@/features/command-palette/components/icon-theme-selector";
import ThemeSelector from "@/features/command-palette/components/theme-selector";
import { useDiagnosticsStore } from "@/features/diagnostics/stores/diagnostics-store";
import type { Diagnostic } from "@/features/diagnostics/types";
import { ProjectNameMenu } from "@/features/file-system/components/project-name-menu";
import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import ContentGlobalSearch from "@/features/global-search/components/content-global-search";
import { SplitViewRoot } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import QuickOpen from "@/features/quick-open/components/quick-open";
import { useSettingsStore } from "@/features/settings/store";
import VimCommandBar from "@/features/vim/components/vim-command-bar";
import { useVimKeyboard } from "@/features/vim/hooks/use-vim-keyboard";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useFolderDrop } from "@/hooks/use-folder-drop";
import { useUIState } from "@/stores/ui-state-store";
import { useWorkspaceTabsStore } from "@/stores/workspace-tabs-store";
import { parseDroppedPaths } from "@/utils/dropped-file-paths";
import { VimSearchBar } from "../../vim/components/vim-search-bar";
import CustomTitleBarWithSettings from "../../window/custom-title-bar";
import BottomPane from "./bottom-pane/bottom-pane";
import EditorFooter from "./footer/editor-footer";
import { ResizablePane } from "./resizable-pane";
import { MainSidebar } from "./sidebar/main-sidebar";

const SIDEBAR_COLLAPSE_THRESHOLD = 48;

function SidebarRestoreHandle({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const isLeft = side === "left";

  return (
    <div className={`flex shrink-0 items-center py-2 ${isLeft ? "pr-1 pl-0" : "pr-0 pl-1"}`}>
      <button
        type="button"
        onClick={onClick}
        className={`flex h-16 w-5 items-center justify-center border border-border bg-secondary-bg/90 text-text-lighter transition-colors hover:bg-hover hover:text-text ${
          isLeft ? "rounded-r-full border-l-0" : "rounded-l-full border-r-0"
        }`}
        aria-label={`Show ${side} sidebar`}
        title="Show sidebar"
      >
        {isLeft ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </button>
    </div>
  );
}

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
  const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const isSwitchingProject = useFileSystemStore.use.isSwitchingProject?.() ?? false;
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProjectTab = useMemo(() => projectTabs.find((tab) => tab.isActive), [projectTabs]);

  const shouldRestoreWorkspace = useRef(true);
  const { isDraggingOver } = useFolderDrop(async (paths) => {
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
    if (!shouldRestoreWorkspace.current || !activeProjectTab) return;
    if (rootFolderPath === activeProjectTab.path) {
      shouldRestoreWorkspace.current = false;
      return;
    }
    if (isSwitchingProject) return;

    const restoreWorkspace = async () => {
      if (switchToProject && setIsSwitchingProject) {
        // Set flag BEFORE calling switchToProject to prevent tab bar from hiding
        setIsSwitchingProject(true);

        try {
          const restored = await switchToProject(activeProjectTab.id);
          const currentRootPath = useFileSystemStore.getState().rootFolderPath;
          if (restored || currentRootPath === activeProjectTab.path) {
            shouldRestoreWorkspace.current = false;
            return;
          }

          setIsSwitchingProject(false);
        } catch (error) {
          console.error("Failed to restore workspace:", error);
          // Make sure to clear the flag even if restoration fails
          setIsSwitchingProject(false);
        }
      }
    };

    restoreWorkspace();
  }, [
    activeProjectTab,
    isSwitchingProject,
    rootFolderPath,
    switchToProject,
    setIsSwitchingProject,
  ]);

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
          {sidebarPosition === "left" &&
            (isSidebarVisible ? (
              <ResizablePane
                position="left"
                widthKey="sidebarWidth"
                collapsible
                collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLD}
                onCollapse={() => setIsSidebarVisible(false)}
              >
                <MainSidebar />
              </ResizablePane>
            ) : (
              <SidebarRestoreHandle side="left" onClick={() => setIsSidebarVisible(true)} />
            ))}

          {/* Main content area with split view */}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col px-2 py-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary-bg">
              <div className="relative min-h-0 flex-1 overflow-hidden">
                <SplitViewRoot />
              </div>
              <BottomPane diagnostics={diagnostics} onDiagnosticClick={handleDiagnosticClick} />
            </div>
          </div>

          {sidebarPosition === "right" &&
            (isSidebarVisible ? (
              <ResizablePane
                position="right"
                widthKey="sidebarWidth"
                collapsible
                collapseThreshold={SIDEBAR_COLLAPSE_THRESHOLD}
                onCollapse={() => setIsSidebarVisible(false)}
              >
                <MainSidebar />
              </ResizablePane>
            ) : (
              <SidebarRestoreHandle side="right" onClick={() => setIsSidebarVisible(true)} />
            ))}
        </div>
      </div>

      <EditorFooter />

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
    </div>
  );
}
