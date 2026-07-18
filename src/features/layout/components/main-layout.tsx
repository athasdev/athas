import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useChatInitialization } from "@/features/ai/hooks/use-chat-initialization";
import { useCollaborationPresence } from "@/features/collaboration/hooks/use-collaboration-presence";
import { initializeDebuggerEventBridge } from "@/features/debugger/services/debug-adapter-events";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { getSymlinkInfo } from "@/features/file-system/controllers/platform";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFileSystemFolderDrop } from "@/features/file-system/hooks/use-file-system-folder-drop";
import { openDroppedWorkspacePaths } from "@/features/file-system/utils/open-dropped-workspace-paths";
import { useGitStore } from "@/features/git/stores/git.store";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding.store";
import { SplitViewRoot } from "@/features/panes/components/split-view-root";
import { usePaneKeyboard } from "@/features/panes/hooks/use-pane-keyboard";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useVimStore } from "@/features/vim/stores/vim.store";
import { isWslPath } from "@/features/wsl/utils/wsl-path";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { useMenuEventsWrapper } from "@/features/window/hooks/use-menu-events-wrapper";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { toast } from "@/ui/toast";
import { frontendTrace } from "@/utils/frontend-trace";
import { getInternalTabDragData } from "@/features/tabs/utils/internal-tab-drag";
import TitleBarWithSettings from "../../window/components/title-bar/title-bar";
import Footer from "./footer/footer";
import { ResizablePane } from "./resizable-pane";
import { MainSidebar, SidebarActivityRail } from "./sidebar/main-sidebar";

const AIChat = lazy(() => import("@/features/ai/components/chat/ai-chat"));
const AgentLauncher = lazy(() =>
  import("@/features/ai/components/agent-launcher").then((module) => ({
    default: module.AgentLauncher,
  })),
);
const CommandPalette = lazy(() => import("@/features/command-palette/components/command-palette"));
const ConnectionDialog = lazy(() =>
  import("@/features/database/components/connection/connection-dialog").then((module) => ({
    default: module.ConnectionDialog,
  })),
);
const LinuxFolderPickerDialog = lazy(
  () => import("@/features/file-system/components/linux-folder-picker-dialog"),
);
const ProjectNameMenu = lazy(() =>
  import("@/features/file-system/components/project-name-menu").then((module) => ({
    default: module.ProjectNameMenu,
  })),
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

const EMPTY_PROJECT_FILES: FileEntry[] = [];
const EMPTY_BUFFERS: PaneContent[] = [];
export function MainLayout() {
  const [deferredSurfacesReady, setDeferredSurfacesReady] = useState(false);

  useChatInitialization();
  usePaneKeyboard();
  useCollaborationPresence();

  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const isSidebarRailExpanded = useUIState((state) => state.isSidebarRailExpanded);
  const isRightSidebarVisible = useUIState((state) => state.isRightSidebarVisible);
  const activeRightSidebarView = useUIState((state) => state.activeRightSidebarView);
  const isDatabaseConnectionVisible = useUIState((state) => state.isDatabaseConnectionVisible);
  const setIsDatabaseConnectionVisible = useUIState(
    (state) => state.setIsDatabaseConnectionVisible,
  );
  const showInlineAiChat = useSettingsStore((state) => state.settings.isAIChatVisible);
  const vimRelativeLineNumbers = useSettingsStore((state) => state.settings.vimRelativeLineNumbers);
  const relativeLineNumbers = useVimStore.use.relativeLineNumbers();
  const { setRelativeLineNumbers } = useVimStore.use.actions();
  const buffers = useBufferStore((state) => (showInlineAiChat ? state.buffers : EMPTY_BUFFERS));
  const activeBuffer = useBufferStore((state) => {
    if (!showInlineAiChat || !state.activeBufferId) return null;
    return getBufferById(state.buffers, state.activeBufferId);
  });
  const handleOpenFolderByPath = useFileSystemStore.use.handleOpenFolderByPath?.();
  const handleFileOpen = useFileSystemStore.use.handleFileOpen?.();
  const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();
  const allProjectFiles = useFileSystemStore(
    (state) => state.projectFilesCache?.files ?? EMPTY_PROJECT_FILES,
  );
  const switchToProject = useFileSystemStore.use.switchToProject?.();
  const setIsSwitchingProject = useFileSystemStore.use.setIsSwitchingProject?.();
  const refreshWorkspaceGitStatus = useGitStore((state) => state.actions.refreshWorkspaceGitStatus);
  const setWorkspaceGitStatus = useGitStore((state) => state.actions.setWorkspaceGitStatus);
  const onboardingOpen = useOnboardingStore((state) => state.isOpen);
  const onboardingContext = useOnboardingStore((state) => state.context);
  const consumeOnboardingOpenRequest = useOnboardingStore((state) => state.consumeOpenRequest);
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
        const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
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

        useWorkspaceTabsStore.getState().removeProjectTab(activeTab.id);
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
    <div className="athas-layout-shell relative flex size-full flex-col overflow-hidden bg-secondary-bg">
      {/* Drag-and-drop overlay */}
      {isDraggingOver && !getInternalTabDragData() && (
        <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-primary-bg/90 backdrop-blur-sm">
          <div className="rounded-xl border-2 border-accent border-dashed bg-secondary-bg px-8 py-6">
            <p className="ui-text-base font-semibold text-text">
              Drop folder to open project, or file to open buffer
            </p>
          </div>
        </div>
      )}

      <TitleBarWithSettings />

      <div className="athas-workbench-glass relative z-10 flex flex-1 flex-col overflow-hidden">
        <div
          className="flex flex-1 flex-row overflow-hidden pr-[var(--athas-workbench-gap)]"
          style={{ minHeight: 0 }}
        >
          <SidebarActivityRail expanded={isSidebarRailExpanded} />
          <ResizablePane position="left" widthKey="sidebarWidth" hidden={!isSidebarVisible}>
            <MainSidebar paneLevel="primary" />
          </ResizablePane>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="athas-glass-island relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/70 bg-primary-bg">
              <SplitViewRoot />
            </div>
            {terminalWidthMode === "editor" && deferredSurfacesReady && (
              <Suspense fallback={null}>
                <BottomPane />
              </Suspense>
            )}
          </div>

          {/* Right side panes are ordered from inner to edge. */}
          {showInlineAiChat && deferredSurfacesReady ? (
            <ResizablePane position="right" widthKey="aiChatWidth">
              <Suspense fallback={null}>
                <AIChat
                  mode="chat"
                  activeBuffer={activeBuffer}
                  buffers={buffers}
                  allProjectFiles={allProjectFiles}
                />
              </Suspense>
            </ResizablePane>
          ) : null}

          <ResizablePane position="right" widthKey="sidebarWidth" hidden={!isRightSidebarVisible}>
            <MainSidebar
              paneLevel="edge"
              activeView={activeRightSidebarView}
              isGitActive={false}
              isGitHubPRsActive={false}
            />
          </ResizablePane>
        </div>

        {terminalWidthMode === "full" && deferredSurfacesReady && (
          <div className="px-[var(--athas-workbench-gap)]">
            <Suspense fallback={null}>
              <BottomPane />
            </Suspense>
          </div>
        )}
      </div>

      <Footer />

      {/* Global modals and overlays */}
      {deferredSurfacesReady ? (
        <Suspense fallback={null}>
          <QuickOpen />
          <CommandPalette />
          <ExtensionGenerationCommand />
          <AgentLauncher />
          <ProjectNameMenu />

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
