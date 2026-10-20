import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import { useRunningAgentProjectIds } from "@/features/ai/hooks/use-running-agent-project-ids";
import { useSessionPanelRuntime } from "@/features/ai/session-panel/hooks/use-session-panel-runtime";
import { useCollaborationPresence } from "@/features/collaboration/hooks/use-collaboration-presence";
import { initializeDebuggerEventBridge } from "@/features/debugger/services/debug-adapter-events";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSymlinkInfo } from "@/features/file-system/api/file-system-api";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFileSystemFolderDrop } from "@/features/file-system/hooks/use-file-system-folder-drop";
import { openDroppedWorkspacePaths } from "@/features/file-system/services/open-dropped-workspace-paths";
import { useGitStore } from "@/features/git/stores/git.store";
import { isGitChangeRelevant, subscribeToGitChanges } from "@/features/git/events/git-events";
import { createGitStatusRefreshScheduler } from "@/features/git/services/git-status-refresh-scheduler";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { CachedWorkspaceSplitViews } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { isWslPath } from "@/features/wsl/services/wsl-path";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { toast } from "sonner";
import { cn } from "@/utils/cn";
import { frontendTrace } from "@/utils/frontend-trace";
import { recordStartupMilestone } from "@/features/bootstrap/services/startup-performance";
import { useBootstrapPhaseReached } from "@/features/bootstrap/stores/bootstrap-phase.store";
import { getInternalTabDragData } from "@/features/tabs/services/internal-tab-drag";
import { WorkbenchFullscreenRootContext } from "@/ui/workbench-fullscreen-surface";
import TitleBarWithSettings from "../../window/components/title-bar/title-bar";
import { TitleLeading } from "../../window/components/title-bar/title-leading";
import { MERGED_TITLE_ROW } from "@/features/window/services/title-row";
import { ResizablePane } from "./resizable-pane";
import { useDockCoversCentre, WorkbenchDock } from "./dock/workbench-dock";
import { useDockOwner } from "../hooks/use-dock-owner";
import { useAgentBufferSessionId } from "../hooks/use-active-session-id";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { ProjectPickerHost, WorkbenchSidebar } from "./sidebar/workbench-sidebar";
import { useResponsiveWorkbenchLayout } from "../hooks/use-responsive-workbench-layout";
import { useProjectStore } from "@/features/workspace/stores/project.store";

const CommandPalette = lazy(() => import("@/features/command-palette/components/command-palette"));
const ConnectionDialog = lazy(() =>
  import("@/features/database/components/connection/connection-dialog").then((module) => ({
    default: module.ConnectionDialog,
  })),
);
const LinuxFolderPickerDialog = lazy(
  () => import("@/features/file-system/components/linux-folder-picker-dialog"),
);
const PreviewsHost = lazy(() =>
  import("@/features/previews/components/previews-host").then((module) => ({
    default: module.PreviewsHost,
  })),
);
const QuickOpen = lazy(() => import("@/features/quick-open/components/quick-open"));
const WindowCloseGuard = lazy(() =>
  import("@/features/window/components/window-close-guard").then((module) => ({
    default: module.WindowCloseGuard,
  })),
);
const SettingsDialog = lazy(() =>
  import("@/features/settings/components/settings-dialog").then((module) => ({
    default: module.SettingsDialog,
  })),
);
const PendingBufferCloseDialog = lazy(() =>
  import("@/features/tabs/components/pending-buffer-close-dialog").then((module) => ({
    default: module.PendingBufferCloseDialog,
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

/**
 * Whether the centre shows a session nobody has written in yet: its start screen floats on the
 * window, without the raised island a conversation sits on. The bottom pane keeps its own island.
 */
function useIsEmptySessionInFront(): boolean {
  const sessionId = useAgentBufferSessionId();
  const isEmptySession = useAIChatStore((state) =>
    sessionId ? (state.messagesByChat[sessionId]?.length ?? 0) === 0 : false,
  );
  // Split panes each keep their island, so only a centre of one pane clears.
  const isSinglePane = usePaneStore((state) => state.root.type === "group");
  // An empty workbench is about to show a new session, so it clears the same way.
  const isEmptyWorkbench = usePaneStore(
    (state) => state.root.type === "group" && state.root.bufferIds.length === 0,
  );
  return isSinglePane && (isEmptySession || isEmptyWorkbench);
}

export function MainLayout() {
  const [deferredSurfacesReady, setDeferredSurfacesReady] = useState(false);
  const layoutShellRef = useRef<HTMLDivElement | null>(null);
  const [layoutShell, setLayoutShell] = useState<HTMLDivElement | null>(null);
  const setLayoutShellElement = useCallback((element: HTMLDivElement | null) => {
    layoutShellRef.current = element;
    setLayoutShell(element);
  }, []);
  useChatInitialization();
  useSessionPanelRuntime();
  const runningAgentProjectIds = useRunningAgentProjectIds();
  usePaneKeyboard();
  useCollaborationPresence();

  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const bottomBuffersVisible = useUIState(
    (state) => state.isBottomPaneVisible && state.bottomPaneActiveTab === "buffers",
  );
  const { setBottomBuffersVisible } = usePaneStore.use.actions();
  const responsiveLayout = useResponsiveWorkbenchLayout();
  const dockOwner = useDockOwner();
  const dockCoversCentre = useDockCoversCentre(dockOwner);
  const renderedSidebarVisible = isSidebarVisible && !responsiveLayout.narrow;
  const clearCentre = useIsEmptySessionInFront();
  const isDatabaseConnectionVisible = useUIState((state) => state.isDatabaseConnectionVisible);
  const setIsDatabaseConnectionVisible = useUIState(
    (state) => state.setIsDatabaseConnectionVisible,
  );
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const handleOpenFolderByPath = useFileSystemStore((state) => state.handleOpenFolderByPath);
  const handleFileOpen = useFileSystemStore((state) => state.handleFileOpen);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const setIsSwitchingProject = useFileSystemStore((state) => state.setIsSwitchingProject);
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);
  const setWorkspaceGitStatus = useGitStore((state) => state.actions.setWorkspaceGitStatus);
  const onboardingOpen = useOnboardingStore((state) => state.isOpen);
  const onboardingContext = useOnboardingStore((state) => state.context);
  const consumeOnboardingOpenRequest = useOnboardingStore(
    (state) => state.actions.consumeOpenRequest,
  );
  const openOnboardingBuffer = useBufferStore.use.actions().openOnboardingBuffer;
  const hasRestoredWorkspace = useRef(false);
  const settingsReady = useBootstrapPhaseReached("settings-ready");
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

  useEffect(() => {
    setBottomBuffersVisible(bottomBuffersVisible);
  }, [bottomBuffersVisible, setBottomBuffersVisible]);

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

  // Restore workspace on app startup. Switching to a project reads settings such as the theme.
  useEffect(() => {
    if (!settingsReady || hasRestoredWorkspace.current) return;

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
  }, [settingsReady, switchToProject, setIsSwitchingProject]);

  useEffect(() => {
    if (!rootFolderPath) {
      setWorkspaceGitStatus(null, null);
      return;
    }

    const scheduler = createGitStatusRefreshScheduler(() => {
      void refreshWorkspaceGitStatus(rootFolderPath);
    });

    const unsubscribe = subscribeToGitChanges((change) => {
      if (isGitChangeRelevant(change, rootFolderPath)) scheduler.schedule(change);
    });

    return () => {
      unsubscribe();
      scheduler.dispose();
    };
  }, [rootFolderPath, refreshWorkspaceGitStatus, setWorkspaceGitStatus]);

  return (
    <div
      ref={setLayoutShellElement}
      className="athas-layout-shell relative flex size-full flex-col overflow-hidden bg-surface"
    >
      <WorkbenchFullscreenRootContext.Provider value={layoutShell}>
        {/* Drag-and-drop overlay */}
        {isDraggingOver && !getInternalTabDragData() && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background backdrop-blur-sm">
            <div className="rounded-xl border-2 border-primary border-dashed bg-surface px-8 py-6">
              <p className="ui-text-base font-semibold text-foreground">
                Drop folder to open project, or file to open buffer
              </p>
            </div>
          </div>
        )}

        {MERGED_TITLE_ROW ? null : (
          <div
            data-slot="workbench-title-row"
            data-tauri-drag-region
            className="relative z-20 h-title-bar shrink-0"
          >
            <TitleLeading />
          </div>
        )}

        <div
          className={cn(
            "athas-workbench-glass relative z-10 flex min-h-0 flex-1 flex-row overflow-hidden p-workbench",
            !MERGED_TITLE_ROW && "pt-0",
          )}
        >
          {MERGED_TITLE_ROW ? (
            <div
              aria-hidden
              data-slot="workbench-top-gap"
              data-tauri-drag-region
              className="absolute inset-x-0 top-0 h-workbench"
            />
          ) : null}
          <ResizablePane hidden={!renderedSidebarVisible}>
            <WorkbenchSidebar titleRow={MERGED_TITLE_ROW} />
          </ResizablePane>

          <div
            data-slot="workbench-centre"
            className={cn("flex min-h-0 min-w-90 flex-1 flex-col", dockCoversCentre && "hidden")}
          >
            <div
              data-slot="workbench-island"
              data-island={clearCentre ? "clear" : undefined}
              className="relative min-h-0 flex-1"
            >
              <CachedWorkspaceSplitViews keepMountedWorkspaceIds={runningAgentProjectIds} />
            </div>
            {deferredSurfacesReady && (
              <Suspense fallback={null}>
                <BottomPane />
              </Suspense>
            )}
          </div>
          <WorkbenchDock owner={dockOwner} />
        </div>

        {MERGED_TITLE_ROW ? <TitleLeading merged sidebarShown={renderedSidebarVisible} /> : null}

        <TitleBarWithSettings showMinimal overlay />

        <ProjectPickerHost />

        {/* Global modals and overlays */}
        {deferredSurfacesReady ? (
          <Suspense fallback={null}>
            <QuickOpen />
            <CommandPalette />
            <ConnectionDialog
              isOpen={isDatabaseConnectionVisible}
              onClose={() => setIsDatabaseConnectionVisible(false)}
            />
            <LinuxFolderPickerDialog />
            <WindowCloseGuard />
            <PendingBufferCloseDialog />
            <SettingsDialog />
            <ExtensionDialogs />
            <PreviewsHost />
            <TerminalHost />
          </Suspense>
        ) : null}
      </WorkbenchFullscreenRootContext.Provider>
    </div>
  );
}
