import { memo, useCallback, useLayoutEffect, useRef } from "react";
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
import { ActivityProjectDots } from "@/features/layout/components/sidebar/activity-project-dots";
import { ActivityProjectSwitcher } from "@/features/layout/components/sidebar/activity-project-switcher";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { useActivityNavigationItems } from "@/features/layout/hooks/use-activity-navigation-items";
import { useActivityProjectCarousel } from "@/features/layout/hooks/use-activity-project-carousel";
import { useActivitySidebarResize } from "@/features/layout/hooks/use-activity-sidebar-resize";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { ContextMenu, ContextMenuTrigger } from "@/ui/context-menu";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";

interface ActivitySidebarProps {
  expanded: boolean;
}

export const COLLAPSED_ACTIVITY_RAIL_WIDTH = 40;

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
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const railContentRef = useRef<HTMLDivElement>(null);
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
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
  const {
    enabled: projectCarouselEnabled,
    projects: projectTabs,
    currentProject: carouselProject,
    carouselProjects,
    renderedProjects: renderedCarouselProjects,
    loadingProjectId: loadingCarouselProjectId,
    isSwitchingProject,
    selectProject: handleProjectSelect,
    handleScroll: handleProjectScroll,
  } = useActivityProjectCarousel({
    alignCurrentProject: alignProjectCarouselToCurrent,
    isResizing: isActivityRailResizing,
  });

  useLayoutEffect(() => {
    alignProjectCarouselToCurrent();
  }, [alignProjectCarouselToCurrent, carouselProject?.id, carouselProjects.length, railPanelWidth]);

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
          "relative box-border flex h-full w-full shrink-0 snap-start snap-always flex-col items-start gap-2 overflow-hidden pt-2 pl-chrome-inline",
          expanded && projectCarouselEnabled && showActivityRailProjectIcons ? "pb-7" : "pb-1.5",
          !expanded && "pr-chrome-inline",
          !isCurrent && "pointer-events-none",
        )}
      >
        {showActivityRailProjectSwitcher ? (
          <ActivityProjectSwitcher
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
          <ActivityProjectDots
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
