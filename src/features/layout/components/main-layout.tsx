import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import { useCollaborationPresence } from "@/features/collaboration/hooks/use-collaboration-presence";
import { initializeDebuggerEventBridge } from "@/features/debugger/services/debug-adapter-events";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFileSystemFolderDrop } from "@/features/file-system/hooks/use-file-system-folder-drop";
import { openDroppedWorkspacePaths } from "@/features/file-system/utils/open-dropped-workspace-paths";
import { useGitStore } from "@/features/git/stores/git.store";
import { isGitChangeRelevant, subscribeToGitChanges } from "@/features/git/events/git-events";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { CachedWorkspaceSplitViews } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { isWslPath } from "@/features/wsl/utils/wsl-path";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
import { frontendTrace } from "@/utils/frontend-trace";
import { recordStartupMilestone } from "@/features/bootstrap/startup-performance";
import { getInternalTabDragData } from "@/features/tabs/utils/internal-tab-drag";
import TitleBarWithSettings from "../../window/components/title-bar/title-bar";
import Footer from "./footer/footer";
import { ResizablePane } from "./resizable-pane";
import { ActivityBar, COLLAPSED_ACTIVITY_BAR_WIDTH } from "./sidebar/activity-bar";
import { SidebarPane } from "./sidebar/sidebar-pane";
import { useResponsiveWorkbenchLayout } from "../hooks/use-responsive-workbench-layout";

const CommandPalette = lazy(() => import("@/features/command-palette/components/command-palette"));
const ConnectionDialog = lazy(() =>
  import("@/features/database/components/connection/connection-dialog").then((module) => ({
    default: module.ConnectionDialog,
  })),
);
const LinuxFolderPickerDialog = lazy(
  () => import("@/features/file-system/components/linux-folder-picker-dialog"),
);
const ExtensionGenerationCommand = lazy(() =>
  import("@/features/generate/components/extension-generation-command").then((module) => ({
    default: module.ExtensionGenerationCommand,
  })),
);
const QuickOpen = lazy(() => import("@/features/quick-open/components/quick-open"));
const WindowCloseGuard = lazy(() =>
  import("@/features/window/components/window-close-guard").then((module) => ({
    default: module.WindowCloseGuard,
  })),
);
const ExtensionDialogs = lazy(() =>
  import("@/extensions/ui/components/extension-dialog").then((module) => ({
    default: module.ExtensionDialogs,
  })),
);
const TerminalHost = lazy(() =>
  import("@/features/terminal/components/terminal-host").then((module) => ({
    default: module.TerminalHost,
  })),
);
const BottomPane = lazy(() => import("./bottom-pane/bottom-pane"));

export function MainLayout() {
  const [deferredSurfacesReady, setDeferredSurfacesReady] = useState(false);

  useChatInitialization();
  usePaneKeyboard();
  useCollaborationPresence();

  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const activityRailExpanded = useSettingsStore((state) => state.settings.activityRailExpanded);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const responsiveLayout = useResponsiveWorkbenchLayout(activityRailExpanded);
  const renderedActivityRailExpanded = responsiveLayout.activityBarExpanded;
  const renderedSidebarVisible = isSidebarVisible && !responsiveLayout.narrow;
  const activityRailWidth = useSettingsStore((state) => state.settings.activityRailWidth);
  const sidebarWidth = useSettingsStore((state) => state.settings.sidebarWidth);
  const rightSidebarWidth = useSettingsStore((state) => state.settings.rightSidebarWidth);
  const showStatusBar = useSettingsStore((state) => state.settings.showStatusBar);
  const isRightSidebarVisible = useUIState((state) => state.isRightSidebarVisible);
  const renderedRightSidebarVisible = isRightSidebarVisible && !responsiveLayout.narrow;
  const activeRightSidebarView = useUIState((state) => state.activeRightSidebarView);
  const isDatabaseConnectionVisible = useUIState((state) => state.isDatabaseConnectionVisible);
  const setIsDatabaseConnectionVisible = useUIState(
    (state) => state.setIsDatabaseConnectionVisible,
  );
  const renderedActivityRailWidth = renderedActivityRailExpanded
    ? activityRailWidth
    : COLLAPSED_ACTIVITY_BAR_WIDTH;
  const leftPaneReservedWidth =
    renderedActivityRailWidth + (renderedRightSidebarVisible ? rightSidebarWidth : 0);
  const rightPaneReservedWidth =
    renderedActivityRailWidth + (renderedSidebarVisible ? sidebarWidth : 0);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const handleOpenFolderByPath = useFileSystemStore.use.handleOpenFolderByPath?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);
  const setWorkspaceGitStatus = useGitStore((state) => state.actions.setWorkspaceGitStatus);
  const onboardingOpen = useOnboardingStore((state) => state.isOpen);
  const onboardingContext = useOnboardingStore((state) => state.context);
  const consumeOnboardingOpenRequest = useOnboardingStore(
    (state) => state.actions.consumeOpenRequest,
  );
  const openOnboardingBuffer = useBufferStore.use.actions().openOnboardingBuffer;
  const hasRestoredWorkspace = useRef(false);
  const { isDraggingOver } = useFileSystemFolderDrop(async (paths) => {
    if (!paths || paths.length === 0) return;

    const result = await openDroppedWorkspacePaths(paths, {
      getPathInfo: getSymlinkInfo,
      openFolder: handleOpenFolderByPath,
      openFile: handleFileOpen
        ? async (path) => {
            await handleFileOpen(path, false);
            return true;
          }
        : undefined,
      onError: (path, error) => {
        console.error("Failed to open dropped path:", path, error);
      },
    });

    if (result.openedFolderCount + result.openedFileCount === 0) {
      toast.warning("No supported dropped files or folders could be opened.");
    }
  }, !rootFolderPath);

  const terminalWidthMode = useTerminalStore((state) => state.widthMode);
  const isEditorBottomPaneVisible =
    terminalWidthMode === "editor" && deferredSurfacesReady && isBottomPaneVisible;
  const roundMainContentLeftEdge = !renderedSidebarVisible;
  const roundMainContentRightEdge = !renderedRightSidebarVisible;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.setTimeout(() => setDeferredSurfacesReady(true), 0);
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    void initializeDebuggerEventBridge();
  }, []);

  useEffect(() => {
    if (!onboardingOpen || !onboardingContext) return;

    openOnboardingBuffer(onboardingContext);
    consumeOnboardingOpenRequest();
  }, [consumeOnboardingOpenRequest, onboardingContext, onboardingOpen, openOnboardingBuffer]);

  useEffect(() => {
    if (vimRelativeLineNumbers !== relativeLineNumbers) {
      setRelativeLineNumbers(vimRelativeLineNumbers, {
        persist: false,
      });
    }
  }, [vimRelativeLineNumbers, relativeLineNumbers, setRelativeLineNumbers]);

  // Initialize event listeners
  useMenuEventsWrapper();

  // Restore workspace on app startup
  useEffect(() => {
    if (hasRestoredWorkspace.current) return;

    const resolveRestorableActiveTab = async () => {
      while (true) {
        const activeTab = useWorkspaceTabsStore.getState().actions.getActiveProjectTab();
        if (!activeTab) return null;

        if (activeTab.path.startsWith("remote://") || isWslPath(activeTab.path)) {
          return activeTab;
        }

        try {
          const info = await getSymlinkInfo(activeTab.path);
          if (info.is_dir) {
            return activeTab;
          }
        } catch (error) {
          console.warn("Persisted workspace no longer exists:", activeTab.path, error);
        }

        useWorkspaceTabsStore.getState().actions.removeProjectTab(activeTab.id);
        toast.warning(`Removed missing project "${activeTab.name}"`);
      }
    };

    const restoreWorkspace = async () => {
      // Get the active project tab from persisted state
      const activeTab = await resolveRestorableActiveTab();
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
          recordStartupMilestone("workspace:ready");
        } catch (error) {
          console.error("Failed to restore workspace:", error);
          frontendTrace("error", "workspace-open", "startupRestore:error", {
            tabPath: activeTab.path,
          });
          recordStartupMilestone("workspace:error");
          // Make sure to clear the flag even if restoration fails
          setIsSwitchingProject(false);
        }
      } else {
        recordStartupMilestone("workspace:ready");
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

    const unsubscribe = subscribeToGitChanges((change) => {
      if (!isGitChangeRelevant(change, rootFolderPath)) return;

      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        void refreshWorkspaceGitStatus(rootFolderPath);
      }, 300);
    });

    return () => {
      unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [rootFolderPath, refreshWorkspaceGitStatus, setWorkspaceGitStatus]);

  return (
    <div className="athas-layout-shell relative flex size-full flex-col overflow-hidden bg-surface">
      {/* Drag-and-drop overlay */}
      {isDraggingOver && !getInternalTabDragData() && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-primary border-dashed bg-surface px-8 py-6">
            <p className="ui-text-base font-semibold text-foreground">
              Drop folder to open project, or file to open buffer
            </p>
          </div>
        </div>
      )}

      <TitleBarWithSettings
        activityBarExpanded={renderedActivityRailExpanded}
        onActivityBarExpandedChange={(expanded) => {
          if (responsiveLayout.compact) {
            responsiveLayout.setActivityBarExpanded(expanded);
          } else {
            void updateSetting("activityRailExpanded", expanded);
          }
        }}
      />

      <div className="athas-workbench-glass relative z-10 flex flex-1 flex-col overflow-hidden">
        <div className="flex flex-1 flex-row overflow-hidden pr-workbench" style={{ minHeight: 0 }}>
          <ActivityBar expanded={renderedActivityRailExpanded} />
          <ResizablePane
            position="left"
            widthKey="sidebarWidth"
            hidden={!renderedSidebarVisible}
            reservedWidth={leftPaneReservedWidth}
          >
            <SidebarPane paneLevel="primary" />
          </ResizablePane>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                "athas-glass-island relative min-h-0 flex-1 overflow-hidden border-border/70 border-y border-r bg-background",
                roundMainContentLeftEdge &&
                  (isEditorBottomPaneVisible ? "rounded-tl-xl border-l" : "rounded-l-xl border-l"),
                roundMainContentRightEdge &&
                  (isEditorBottomPaneVisible ? "rounded-tr-xl" : "rounded-r-xl"),
              )}
            >
              <CachedWorkspaceSplitViews />
            </div>
            {terminalWidthMode === "editor" && deferredSurfacesReady && (
              <Suspense fallback={null}>
                <BottomPane
                  embedded
                  roundLeftEdge={roundMainContentLeftEdge}
                  roundRightEdge={roundMainContentRightEdge}
                />
              </Suspense>
            )}
          </div>

          <ResizablePane
            position="right"
            widthKey="rightSidebarWidth"
            hidden={!renderedRightSidebarVisible}
            reservedWidth={rightPaneReservedWidth}
          >
            <SidebarPane
              paneLevel="edge"
              activeView={activeRightSidebarView}
              isGitActive={false}
              isGitHubPRsActive={false}
            />
          </ResizablePane>
        </div>

        {terminalWidthMode === "full" && deferredSurfacesReady && (
          <div className="px-workbench">
            <Suspense fallback={null}>
              <BottomPane />
            </Suspense>
          </div>
        )}
      </div>

      {showStatusBar ? <Footer /> : null}

      {/* Global modals and overlays */}
      {deferredSurfacesReady ? (
        <Suspense fallback={null}>
          <QuickOpen />
          <CommandPalette />
          <ExtensionGenerationCommand />
          <ConnectionDialog
            isOpen={isDatabaseConnectionVisible}
            onClose={() => setIsDatabaseConnectionVisible(false)}
          />
          <LinuxFolderPickerDialog />
          <WindowCloseGuard />
          <ExtensionDialogs />
          <TerminalHost />
        </Suspense>
      ) : null}
    </div>
  );
}
