import { memo, useCallback, useLayoutEffect, useRef } from "react";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import { DiagnosticsActivityControl } from "@/features/diagnostics/components/diagnostics-activity-control";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { ActivityBarMenu } from "@/features/layout/components/sidebar/activity-bar-menu";
import { ActivityProjectDots } from "@/features/layout/components/sidebar/activity-project-dots";
import { ActivityProjectPanel } from "@/features/layout/components/sidebar/activity-project-panel";
import { useActivityBarResize } from "@/features/layout/hooks/use-activity-bar-resize";
import { useActivityBarVisibility } from "@/features/layout/hooks/use-activity-bar-visibility";
import { useActivityNavigationItems } from "@/features/layout/hooks/use-activity-navigation-items";
import { useActivityProjectCarousel } from "@/features/layout/hooks/use-activity-project-carousel";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { getCollapsedActivityBarWidth } from "@/features/layout/utils/activity-bar-layout";
import { OnboardingChecklist } from "@/features/onboarding/components/onboarding-checklist";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { ContextMenu, ContextMenuTrigger } from "@/ui/context-menu";
import { MagnifyingGlassIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

interface ActivityBarProps {
  expanded: boolean;
}

export const ActivityBar = memo(({ expanded }: ActivityBarProps) => {
  const { openSidebarView } = useSidebarPaneController();
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const isBottomPaneVisible = useUIState((state) => state.isBottomPaneVisible);
  const bottomPaneActiveTab = useUIState((state) => state.bottomPaneActiveTab);
  const isCommandPaletteVisible = useUIState((state) => state.isCommandPaletteVisible);
  const commandPaletteInitialView = useUIState((state) => state.commandPaletteInitialView);
  const openCommandPaletteView = useUIState((state) => state.openCommandPaletteView);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const openSettingsBuffer = useBufferStore.use.actions().openSettingsBuffer;
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions" || activeBuffer?.type === "extension";
  });
  const isGlobalSearchBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "globalSearch";
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
  const handleDebuggerToggle = useCallback(() => {
    const uiState = useUIState.getState();
    const showingDebugger =
      !uiState.isBottomPaneVisible || uiState.bottomPaneActiveTab !== "debugger";
    uiState.setBottomPaneActiveTab("debugger");
    uiState.setIsBottomPaneVisible(showingDebugger);
  }, []);
  const handleOpenDatabases = useCallback(() => {
    openCommandPaletteView("databases");
  }, [openCommandPaletteView]);
  const railContentRef = useRef<HTMLDivElement>(null);
  const uiFontSize = useSettingsStore((state) => state.settings.uiFontSize);
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const activityBarVisibility = useActivityBarVisibility(coreFeatures);
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
    onOpenExtensions: openExtensionsBuffer,
    isExtensionsActive: isExtensionsBufferActive,
    isDebuggerActive: isBottomPaneVisible && bottomPaneActiveTab === "debugger",
    isDatabasesActive: isCommandPaletteVisible && commandPaletteInitialView === "databases",
    onToggleDebugger: handleDebuggerToggle,
    onOpenDatabases: handleOpenDatabases,
  });
  const visibleNavigationItems = activityNavigationItems.filter(
    (item) => !activityBarVisibility.hiddenNavigationItemIds.includes(item.id),
  );
  const filesNavigationIndex = visibleNavigationItems.findIndex((item) => item.id === "files");
  const searchInsertionIndex = Math.max(filesNavigationIndex + 1, 0);
  const visibleActivityNavigationItems = coreFeatures.search
    ? [
        ...visibleNavigationItems.slice(0, searchInsertionIndex),
        {
          id: "search",
          label: "Search",
          icon: <MagnifyingGlassIcon />,
          active: isGlobalSearchBufferActive,
          onClick: openGlobalSearchBuffer,
          ariaLabel: "Search",
          shortcut: "Mod+Shift+F",
        },
        ...visibleNavigationItems.slice(searchInsertionIndex),
      ]
    : visibleNavigationItems;
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
  } = useActivityBarResize({
    expanded,
  });
  const collapsedRailWidth = getCollapsedActivityBarWidth(uiFontSize);
  const railPanelWidth = expanded ? activityRailWidth : collapsedRailWidth;
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

  const renderedRailWidth = expanded
    ? `calc(${activityRailWidth}px + var(--athas-workbench-gap))`
    : `${collapsedRailWidth}px`;
  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={railRef}
        className="relative flex h-full shrink-0 select-none overflow-hidden"
        style={{
          width: renderedRailWidth,
        }}
      >
        <div
          className="athas-sidebar-rail absolute inset-y-0 left-0 flex flex-col overflow-hidden py-1.5"
          style={{ width: railPanelWidth }}
        >
          <div
            ref={railContentRef}
            onScroll={projectCarouselEnabled ? handleProjectScroll : undefined}
            data-slot="project-carousel"
            className={cn(
              "scrollbar-none flex min-h-0 w-full flex-1 shrink-0 overflow-y-hidden overscroll-x-contain",
              projectCarouselEnabled
                ? "snap-x snap-mandatory overflow-x-auto"
                : "overflow-x-hidden",
            )}
          >
            {renderedCarouselProjects.map((project) => (
              <ActivityProjectPanel
                key={project.id}
                expanded={expanded}
                project={project}
                current={project.id === carouselProject?.id}
                loading={project.id === loadingCarouselProjectId}
                navigationItems={visibleActivityNavigationItems}
                showAgents={activityBarVisibility.agentHistory}
                showTerminals={coreFeatures.terminal && activityBarVisibility.terminals}
              />
            ))}
          </div>
          <div
            data-slot="activity-sidebar-footer"
            className="relative z-20 flex w-full shrink-0 flex-col items-center gap-chrome-tight px-chrome-inline"
          >
            <OnboardingChecklist
              expanded={expanded}
              hasProject={Boolean(carouselProject)}
              onOpenProject={() => openProjectPicker()}
              onStartAgent={handleNewAgent}
              onOpenTerminal={handleNewTerminal}
              onOpenCommandPalette={() => useUIState.getState().setIsCommandPaletteVisible(true)}
              onOpenSettings={openSettingsBuffer}
            />
            {expanded && projectCarouselEnabled && activityBarVisibility.projectDots ? (
              <ActivityProjectDots
                projects={projectTabs}
                activeProjectId={carouselProject?.id}
                isSwitchingProject={isSwitchingProject}
                onSelectProject={handleProjectSelect}
              />
            ) : null}
            <DiagnosticsActivityControl expanded={expanded} />
          </div>
        </div>
        {expanded ? (
          <div
            role="separator"
            tabIndex={0}
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
      <ActivityBarMenu
        navigationItems={activityNavigationItems}
        hiddenNavigationItemIds={activityBarVisibility.hiddenNavigationItemIds}
        coreFeatures={coreFeatures}
        showAgentHistory={activityBarVisibility.agentHistory}
        showTerminals={activityBarVisibility.terminals}
        showProjectDots={activityBarVisibility.projectDots}
        hasHiddenItems={activityBarVisibility.hasHiddenItems}
        onNewAgent={handleNewAgent}
        onNewTerminal={handleNewTerminal}
        onNewWorktree={handleNewWorktree}
        onOpenProject={() => openProjectPicker()}
        onSearch={openGlobalSearchBuffer}
        onOpenExtensions={openExtensionsBuffer}
        onNavigationItemVisibleChange={activityBarVisibility.setNavigationItemVisible}
        onAgentHistoryVisibleChange={(visible) =>
          activityBarVisibility.setItemVisible("agentHistory", visible)
        }
        onTerminalsVisibleChange={(visible) =>
          activityBarVisibility.setItemVisible("terminals", visible)
        }
        onProjectDotsVisibleChange={(visible) =>
          activityBarVisibility.setItemVisible("projectDots", visible)
        }
        onShowAll={activityBarVisibility.showAll}
      />
    </ContextMenu>
  );
});
