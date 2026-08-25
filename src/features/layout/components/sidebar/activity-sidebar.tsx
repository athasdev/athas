import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type UIEvent as ReactUIEvent,
} from "react";
import { flushSync } from "react-dom";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  ActivityRailNavigation,
  ActivitySidebarNavigation,
} from "@/features/layout/components/sidebar/activity-navigation";
import { ActivityAgentHistory } from "@/features/layout/components/sidebar/activity-agent-history";
import { ActivityPinnedItems } from "@/features/layout/components/sidebar/activity-pinned-items";
import { ActivitySidebarMenu } from "@/features/layout/components/sidebar/activity-sidebar-menu";
import { ActivityTerminalHistory } from "@/features/layout/components/sidebar/activity-terminal-history";
import { ActivityWorktreeHistory } from "@/features/layout/components/sidebar/activity-worktree-history";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import {
  SidebarProjectDots,
  SidebarProjectSwitcher,
} from "@/features/layout/components/sidebar/sidebar-projects";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { useActivityNavigationItems } from "@/features/layout/hooks/use-activity-navigation-items";
import { useActivitySidebarResize } from "@/features/layout/hooks/use-activity-sidebar-resize";
import {
  getProjectCarouselPageIndex,
  getProjectCarouselWindow,
} from "@/features/layout/utils/project-carousel";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/window/stores/workspace-tabs.store";
import { ContextMenu, ContextMenuTrigger } from "@/ui/context-menu";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ActivitySidebarProps {
  expanded: boolean;
}

export const COLLAPSED_ACTIVITY_RAIL_WIDTH = 40;
const ACTIVITY_RAIL_HORIZONTAL_GUTTER = 8;
const PROJECT_SCROLL_SETTLE_DELAY_MS = 120;

const waitForProjectCarouselPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export const ActivitySidebar = memo(({ expanded }: ActivitySidebarProps) => {
  const { openSidebarView } = useSidebarPaneController();
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions" || activeBuffer?.type === "extension";
  });
  const handleNewAgent = useNewAgentAction();
  const handleNewTerminal = useCallback(() => {
    const uiState = useUIState.getState();
    uiState.setBottomPaneActiveTab("terminal");
    uiState.setIsBottomPaneVisible(true);
    window.dispatchEvent(new CustomEvent("terminal-new"));
  }, []);
  const handleNewWorktree = useCallback(() => {
    openSidebarView("git");
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("athas:git-palette-action", {
          detail: { type: "manage-branches", tab: "worktrees" },
        }),
      );
    }, 0);
  }, [openSidebarView]);
  const openFoldersInNewWindow = useSettingsStore((state) => state.settings.openFoldersInNewWindow);
  const hiddenSidebarActivityItems = useSettingsStore(
    (state) => state.settings.hiddenSidebarActivityItems,
  );
  const showActivityRailProjectSwitcher = useSettingsStore(
    (state) => state.settings.showActivityRailProjectSwitcher,
  );
  const showActivityRailAgentHistory = useSettingsStore(
    (state) => state.settings.showActivityRailAgentHistory,
  );
  const showActivityRailTerminals = useSettingsStore(
    (state) => state.settings.showActivityRailTerminals,
  );
  const showActivityRailWorktrees = useSettingsStore(
    (state) => state.settings.showActivityRailWorktrees,
  );
  const showActivityRailProjectIcons = useSettingsStore(
    (state) => state.settings.showActivityRailProjectIcons,
  );
  const projectCarouselEnabled = !openFoldersInNewWindow;
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [carouselProjectId, setCarouselProjectId] = useState<string | null>(null);
  const [loadingCarouselProjectId, setLoadingCarouselProjectId] = useState<string | null>(null);
  const railContentRef = useRef<HTMLDivElement>(null);
  const isProjectGestureSettlingRef = useRef(false);
  const projectScrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
  const carouselProject =
    projectTabs.find((project) => project.id === carouselProjectId) ?? activeProject;
  const carouselProjectIndex = carouselProject
    ? projectTabs.findIndex((project) => project.id === carouselProject.id)
    : -1;
  const carouselProjects = getProjectCarouselWindow(projectTabs, carouselProjectIndex);
  const renderedCarouselProjects = projectCarouselEnabled
    ? carouselProjects
    : carouselProject
      ? [carouselProject]
      : [];
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const handleSidebarViewChange = (view: typeof activeSidebarView) => {
    openSidebarView(view);
  };

  const activityNavigationItems = useActivityNavigationItems({
    activeSidebarView,
    isGitViewActive,
    isGitHubPRsViewActive,
    isSidebarVisible,
    coreFeatures,
    onViewChange: handleSidebarViewChange,
    onSearch: openGlobalSearchBuffer,
    isSearchActive: false,
    onOpenExtensions: openExtensionsBuffer,
    isExtensionsActive: isExtensionsBufferActive,
  });
  const visibleActivityNavigationItems = activityNavigationItems.filter(
    (item) => !hiddenSidebarActivityItems.includes(item.id),
  );

  const setActivityRailItemVisible = useCallback(
    (itemId: string, visible: boolean) => {
      const currentHiddenItems = useSettingsStore.getState().settings.hiddenSidebarActivityItems;
      const nextHiddenItems = visible
        ? currentHiddenItems.filter((hiddenItemId) => hiddenItemId !== itemId)
        : Array.from(new Set([...currentHiddenItems, itemId]));

      void updateSetting("hiddenSidebarActivityItems", nextHiddenItems);
    },
    [updateSetting],
  );

  const hasHiddenActivityRailItems =
    hiddenSidebarActivityItems.length > 0 ||
    !showActivityRailProjectSwitcher ||
    !showActivityRailAgentHistory ||
    (coreFeatures.terminal && !showActivityRailTerminals) ||
    (coreFeatures.git && !showActivityRailWorktrees) ||
    !showActivityRailProjectIcons;

  const showAllActivityRailItems = useCallback(() => {
    void updateSetting("hiddenSidebarActivityItems", []);
    void updateSetting("showActivityRailProjectSwitcher", true);
    void updateSetting("showActivityRailAgentHistory", true);
    void updateSetting("showActivityRailTerminals", true);
    void updateSetting("showActivityRailWorktrees", true);
    void updateSetting("showActivityRailProjectIcons", true);
  }, [updateSetting]);

  useEffect(() => {
    if (isProjectGestureSettlingRef.current) return;
    setCarouselProjectId(activeProject?.id ?? null);
  }, [activeProject?.id]);

  const alignProjectCarouselToCurrent = useCallback(() => {
    const container = railContentRef.current;
    const currentPanel = container?.querySelector<HTMLElement>(
      '[data-project-carousel-current="true"]',
    );
    if (!container || !currentPanel) return;
    container.scrollLeft = currentPanel.offsetLeft;
  }, []);

  const {
    width: activityRailWidth,
    isResizing: isActivityRailResizing,
    sidebarRef: railRef,
    handleResizeStart,
  } = useActivitySidebarResize({
    expanded,
    contentRef: railContentRef,
    onPreview: alignProjectCarouselToCurrent,
  });
  const railPanelWidth = expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH;

  useLayoutEffect(() => {
    alignProjectCarouselToCurrent();
  }, [alignProjectCarouselToCurrent, carouselProject?.id, carouselProjects.length, railPanelWidth]);

  useEffect(() => {
    if (projectCarouselEnabled) return;

    if (projectScrollEndTimerRef.current !== null) {
      clearTimeout(projectScrollEndTimerRef.current);
      projectScrollEndTimerRef.current = null;
    }

    isProjectGestureSettlingRef.current = false;
    setCarouselProjectId(activeProject?.id ?? null);
    setLoadingCarouselProjectId(null);
  }, [activeProject?.id, projectCarouselEnabled]);

  useEffect(() => {
    return () => {
      if (projectScrollEndTimerRef.current !== null) {
        clearTimeout(projectScrollEndTimerRef.current);
      }
    };
  }, []);

  const activateCarouselProject = useCallback(
    async (projectId: string) => {
      if (
        !projectCarouselEnabled ||
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length === 0
      ) {
        return;
      }

      const targetProject = projectTabs.find((project) => project.id === projectId);
      if (!targetProject || targetProject.id === carouselProject?.id) {
        alignProjectCarouselToCurrent();
        return;
      }
      const targetWasReady = workspaceRuntimeRegistry.isWorkspaceReady(targetProject.id);

      isProjectGestureSettlingRef.current = true;
      if (projectScrollEndTimerRef.current !== null) {
        clearTimeout(projectScrollEndTimerRef.current);
        projectScrollEndTimerRef.current = null;
      }

      flushSync(() => {
        setCarouselProjectId(targetProject.id);
        setLoadingCarouselProjectId(targetWasReady ? null : targetProject.id);
      });
      alignProjectCarouselToCurrent();

      try {
        await waitForProjectCarouselPaint();
        const switched = await switchToProject(targetProject.id);
        if (!switched) {
          flushSync(() => {
            setCarouselProjectId(activeProject?.id ?? null);
            setLoadingCarouselProjectId(null);
          });
          alignProjectCarouselToCurrent();
          return;
        }

        if (!targetWasReady) {
          await waitForProjectCarouselPaint();
        }
        setLoadingCarouselProjectId(null);
      } catch {
        flushSync(() => {
          setCarouselProjectId(activeProject?.id ?? null);
          setLoadingCarouselProjectId(null);
        });
        alignProjectCarouselToCurrent();
      } finally {
        isProjectGestureSettlingRef.current = false;
      }
    },
    [
      activeProject?.id,
      alignProjectCarouselToCurrent,
      carouselProject?.id,
      isActivityRailResizing,
      isSwitchingProject,
      projectCarouselEnabled,
      projectTabs,
      switchToProject,
    ],
  );

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      void activateCarouselProject(projectId);
    },
    [activateCarouselProject],
  );

  const handleProjectScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      if (
        !projectCarouselEnabled ||
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        carouselProjects.length <= 1
      ) {
        return;
      }

      if (projectScrollEndTimerRef.current !== null) {
        clearTimeout(projectScrollEndTimerRef.current);
      }
      const container = event.currentTarget;
      projectScrollEndTimerRef.current = setTimeout(() => {
        projectScrollEndTimerRef.current = null;
        const pageIndex = getProjectCarouselPageIndex(
          container.scrollLeft,
          container.clientWidth,
          carouselProjects.length,
        );
        const targetProject = pageIndex === null ? undefined : carouselProjects[pageIndex];
        if (!targetProject || targetProject.id === carouselProject?.id) {
          alignProjectCarouselToCurrent();
          return;
        }
        void activateCarouselProject(targetProject.id);
      }, PROJECT_SCROLL_SETTLE_DELAY_MS);
    },
    [
      activateCarouselProject,
      alignProjectCarouselToCurrent,
      carouselProject?.id,
      carouselProjects,
      isActivityRailResizing,
      isSwitchingProject,
      projectCarouselEnabled,
    ],
  );

  const renderedRailWidth = `calc(${
    expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH
  }px + var(--athas-workbench-gap))`;
  const renderProjectPanel = (project: ProjectTab) => {
    const isCurrent = project.id === carouselProject?.id;
    const isLoadingProject = project.id === loadingCarouselProjectId;

    return (
      <div
        key={project.id}
        data-project-carousel-current={isCurrent ? "true" : undefined}
        aria-hidden={isCurrent ? undefined : true}
        inert={isCurrent ? undefined : true}
        className={cn(
          "relative flex h-full w-full shrink-0 snap-start snap-always flex-col items-start gap-2 overflow-hidden pt-2",
          expanded && projectCarouselEnabled && showActivityRailProjectIcons ? "pb-7" : "pb-1.5",
          !isCurrent && "pointer-events-none",
        )}
        style={{
          boxSizing: "border-box",
          paddingLeft: ACTIVITY_RAIL_HORIZONTAL_GUTTER,
          paddingRight: expanded ? 0 : ACTIVITY_RAIL_HORIZONTAL_GUTTER,
        }}
      >
        {showActivityRailProjectSwitcher ? (
          <SidebarProjectSwitcher
            expanded={expanded}
            project={project}
            projects={projectTabs}
            isSwitchingProject={isSwitchingProject}
            onSelectProject={handleProjectSelect}
            onAddRemote={() => openProjectPicker("addRemote")}
          />
        ) : null}
        {isLoadingProject ? (
          <div className="flex min-h-0 flex-1 self-stretch items-center justify-center">
            <Spinner label={`Opening ${project.name}`} showLabel={expanded} compact={!expanded} />
          </div>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="scrollbar-none min-h-0 w-full flex-1 overflow-y-auto">
              {expanded ? (
                <ActivitySidebarNavigation items={visibleActivityNavigationItems} />
              ) : (
                <ActivityRailNavigation items={visibleActivityNavigationItems} />
              )}
              {expanded ? (
                <>
                  <ActivityPinnedItems
                    workspacePath={project.path}
                    showAgents={showActivityRailAgentHistory}
                    showTerminals={coreFeatures.terminal && showActivityRailTerminals}
                  />
                  {showActivityRailAgentHistory ? (
                    <ActivityAgentHistory workspacePath={project.path} />
                  ) : null}
                  {coreFeatures.terminal && showActivityRailTerminals ? (
                    <ActivityTerminalHistory />
                  ) : null}
                  {coreFeatures.git && showActivityRailWorktrees ? (
                    <ActivityWorktreeHistory
                      repoPath={project.path}
                      onNewWorktree={handleNewWorktree}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={railRef}
        className="athas-sidebar-rail relative flex h-full shrink-0 select-none overflow-hidden"
        style={{
          width: renderedRailWidth,
        }}
      >
        <div
          ref={railContentRef}
          onScroll={projectCarouselEnabled ? handleProjectScroll : undefined}
          data-slot="project-carousel"
          className={cn(
            "scrollbar-none absolute inset-y-0 left-0 flex shrink-0 overflow-y-hidden overscroll-x-contain",
            projectCarouselEnabled ? "snap-x snap-mandatory overflow-x-auto" : "overflow-x-hidden",
          )}
          style={{
            width: expanded
              ? railPanelWidth
              : `calc(${railPanelWidth}px + var(--athas-workbench-gap))`,
          }}
        >
          {renderedCarouselProjects.map(renderProjectPanel)}
        </div>
        {expanded && projectCarouselEnabled && showActivityRailProjectIcons ? (
          <SidebarProjectDots
            projects={projectTabs}
            activeProjectId={carouselProject?.id}
            isSwitchingProject={isSwitchingProject}
            onSelectProject={handleProjectSelect}
          />
        ) : null}
        {expanded ? (
          <div
            role="separator"
            aria-label="Resize activity rail"
            aria-orientation="vertical"
            className="group absolute top-0 right-0 z-20 flex h-full w-workbench cursor-col-resize items-center justify-center hover:bg-primary/8"
            onMouseDown={handleResizeStart}
          >
            <div className="h-full w-px bg-transparent transition-colors duration-fast ease-smooth group-hover:bg-primary" />
          </div>
        ) : null}
        {isActivityRailResizing ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
      </ContextMenuTrigger>
      <ActivitySidebarMenu
        navigationItems={activityNavigationItems}
        hiddenNavigationItemIds={hiddenSidebarActivityItems}
        coreFeatures={coreFeatures}
        showProjectSwitcher={showActivityRailProjectSwitcher}
        showAgentHistory={showActivityRailAgentHistory}
        showTerminals={showActivityRailTerminals}
        showWorktrees={showActivityRailWorktrees}
        showProjectDots={showActivityRailProjectIcons}
        hasHiddenItems={hasHiddenActivityRailItems}
        onNewAgent={handleNewAgent}
        onNewTerminal={handleNewTerminal}
        onNewWorktree={handleNewWorktree}
        onOpenProject={() => openProjectPicker()}
        onSearch={openGlobalSearchBuffer}
        onOpenExtensions={openExtensionsBuffer}
        onNavigationItemVisibleChange={setActivityRailItemVisible}
        onProjectSwitcherVisibleChange={(visible) =>
          void updateSetting("showActivityRailProjectSwitcher", visible)
        }
        onAgentHistoryVisibleChange={(visible) =>
          void updateSetting("showActivityRailAgentHistory", visible)
        }
        onTerminalsVisibleChange={(visible) =>
          void updateSetting("showActivityRailTerminals", visible)
        }
        onWorktreesVisibleChange={(visible) =>
          void updateSetting("showActivityRailWorktrees", visible)
        }
        onProjectDotsVisibleChange={(visible) =>
          void updateSetting("showActivityRailProjectIcons", visible)
        }
        onShowAll={showAllActivityRailItems}
      />
    </ContextMenu>
  );
});
