import { animate, motion, useMotionValue, useReducedMotionConfig } from "motion/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { flushSync } from "react-dom";
import { CollaborationSidebarView } from "@/features/collaboration/components/collaboration-sidebar";
import { DockerSidebar } from "@/features/docker/components/docker-sidebar";
import { FileExplorerPane } from "@/features/file-explorer/components/file-explorer-pane";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitView from "@/features/git/components/git-view";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import { SidebarPaneSelector } from "@/features/layout/components/sidebar/sidebar-pane-selector";
import {
  SidebarAgentHistory,
  SidebarPinnedItems,
  SidebarTerminalHistory,
  SidebarWorktreeHistory,
} from "@/features/layout/components/sidebar/sidebar-history";
import { useNewAgentAction } from "@/features/ai/hooks/use-new-agent-action";
import {
  SidebarProjectDots,
  SidebarProjectSwitcher,
} from "@/features/layout/components/sidebar/sidebar-projects";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import {
  getAdjacentProjectIndex,
  getProjectCarouselDirection,
  getProjectSnapDuration,
  getProjectSwipeBounds,
} from "@/features/layout/utils/project-carousel";
import { getSidebarPaneLevel, type SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { OutlineSidebar } from "@/features/outline/components/outline-sidebar";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/window/stores/workspace-tabs.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { DynamicIcon } from "@/extensions/ui/components/dynamic-icon";
import { SidebarEmptyState, SidebarPanel } from "@/ui/sidebar";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Spinner } from "@/ui/spinner";
import {
  BoxIcon,
  EyeIcon,
  ExtensionsIcon,
  FilesIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  MagnifyingGlassIcon,
  NodesIcon,
  SparkleIcon,
  TerminalIcon,
} from "@/ui/icons";
import { cn } from "@/utils/cn";

interface MainSidebarProps {
  paneLevel?: "primary" | "edge";
  activeView?: SidebarView;
  isGitActive?: boolean;
  isGitHubPRsActive?: boolean;
}

interface SidebarPaneEntry {
  id: SidebarView;
  content: ReactNode;
}

interface SidebarActivityRailProps {
  expanded?: boolean;
}

export const COLLAPSED_ACTIVITY_RAIL_WIDTH = 40;
const DEFAULT_ACTIVITY_RAIL_WIDTH = 160;
const MIN_ACTIVITY_RAIL_WIDTH = 140;
const MAX_ACTIVITY_RAIL_WIDTH = 320;
const ACTIVITY_RAIL_HORIZONTAL_GUTTER = 8;
const PROJECT_SWIPE_THRESHOLD_PX = 42;
const PROJECT_WHEEL_END_DELAY_MS = 40;
const PROJECT_WHEEL_COMMIT_PROGRESS = 0.82;
const PROJECT_SNAP_TRANSITION = {
  type: "tween" as const,
  ease: [0.2, 0.8, 0.2, 1] as const,
};

const clampActivityRailWidth = (width: number) =>
  Math.min(MAX_ACTIVITY_RAIL_WIDTH, Math.max(MIN_ACTIVITY_RAIL_WIDTH, Math.round(width)));

const waitForProjectCarouselPaint = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });

export const SidebarActivityRail = memo(({ expanded = false }: SidebarActivityRailProps) => {
  const { openSidebarView } = useSidebarPaneController();
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
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
  const configuredActivityRailWidth = useSettingsStore((state) => state.settings.activityRailWidth);
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
  const [activityRailWidth, setActivityRailWidth] = useState(() =>
    clampActivityRailWidth(configuredActivityRailWidth || DEFAULT_ACTIVITY_RAIL_WIDTH),
  );
  const [isActivityRailResizing, setIsActivityRailResizing] = useState(false);
  const [carouselProjectId, setCarouselProjectId] = useState<string | null>(null);
  const [carouselTargetProjectId, setCarouselTargetProjectId] = useState<string | null>(null);
  const [loadingCarouselProjectId, setLoadingCarouselProjectId] = useState<string | null>(null);
  const [projectCarouselDirection, setProjectCarouselDirection] = useState<1 | -1>(1);
  const prefersReducedMotion = useReducedMotionConfig();
  const projectGestureX = useMotionValue(0);
  const railRef = useRef<HTMLDivElement>(null);
  const railContentRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const isProjectGestureSettlingRef = useRef(false);
  const projectWheelEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions";
  });
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const extensionViews = useExtensionViews();
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
  const carouselProject =
    projectTabs.find((project) => project.id === carouselProjectId) ?? activeProject;
  const carouselProjectIndex = carouselProject
    ? projectTabs.findIndex((project) => project.id === carouselProject.id)
    : -1;
  const previousProject =
    carouselProjectIndex >= 0 ? projectTabs[carouselProjectIndex - 1] : undefined;
  const nextProject = carouselProjectIndex >= 0 ? projectTabs[carouselProjectIndex + 1] : undefined;
  const carouselTargetProject = carouselTargetProjectId
    ? projectTabs.find((project) => project.id === carouselTargetProjectId)
    : undefined;
  const renderedPreviousProject =
    projectCarouselDirection < 0 && carouselTargetProject ? carouselTargetProject : previousProject;
  const renderedNextProject =
    projectCarouselDirection > 0 && carouselTargetProject ? carouselTargetProject : nextProject;
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const handleSidebarViewChange = (view: typeof activeSidebarView) => {
    openSidebarView(view);
  };

  const activityRailVisibilityItems = useMemo(
    () => [
      {
        id: "files",
        label: "Files",
        icon: <FilesIcon />,
      },
      ...(coreFeatures.search
        ? [
            {
              id: "search",
              label: "Search",
              icon: <MagnifyingGlassIcon />,
            },
          ]
        : []),
      ...(coreFeatures.git
        ? [
            {
              id: "git",
              label: "Source Control",
              icon: <GitBranchIcon />,
            },
          ]
        : []),
      ...(coreFeatures.github
        ? [
            {
              id: "github-prs",
              label: "Pull Requests",
              icon: <GitPullRequestIcon />,
            },
          ]
        : []),
      ...(coreFeatures.docker
        ? [
            {
              id: "docker",
              label: "Docker",
              icon: <BoxIcon />,
            },
          ]
        : []),
      {
        id: "extensions",
        label: "Extensions",
        icon: <ExtensionsIcon />,
      },
      ...Array.from(extensionViews.values()).map((view) => ({
        id: view.id,
        label: view.title,
        icon: <DynamicIcon name={view.icon} />,
      })),
    ],
    [
      coreFeatures.docker,
      coreFeatures.git,
      coreFeatures.github,
      coreFeatures.search,
      extensionViews,
    ],
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
    if (isResizingRef.current) return;
    setActivityRailWidth(
      clampActivityRailWidth(configuredActivityRailWidth || DEFAULT_ACTIVITY_RAIL_WIDTH),
    );
  }, [configuredActivityRailWidth]);

  useEffect(() => {
    if (isProjectGestureSettlingRef.current) return;
    setCarouselProjectId(activeProject?.id ?? null);
  }, [activeProject?.id]);

  useEffect(() => {
    if (projectCarouselEnabled) return;

    if (projectWheelEndTimerRef.current !== null) {
      clearTimeout(projectWheelEndTimerRef.current);
      projectWheelEndTimerRef.current = null;
    }

    projectGestureX.stop();
    projectGestureX.jump(0);
    isProjectGestureSettlingRef.current = false;
    setCarouselProjectId(activeProject?.id ?? null);
    setCarouselTargetProjectId(null);
    setLoadingCarouselProjectId(null);
  }, [activeProject?.id, projectCarouselEnabled, projectGestureX]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      if (projectWheelEndTimerRef.current !== null) {
        clearTimeout(projectWheelEndTimerRef.current);
      }
    };
  }, []);

  const previewActivityRailWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampActivityRailWidth(nextWidth);
    const expandedRailWidth = `calc(${clampedWidth}px + var(--athas-workbench-gap))`;

    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = requestAnimationFrame(() => {
      if (railRef.current) {
        railRef.current.style.width = expandedRailWidth;
      }

      if (railContentRef.current) {
        railContentRef.current.style.width = `${clampedWidth}px`;
      }

      resizeFrameRef.current = null;
    });
  }, []);

  const handleResizeMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!expanded) return;

      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = activityRailWidth;
      const previousCursor = document.body.style.cursor;
      const previousUserSelect = document.body.style.userSelect;

      isResizingRef.current = true;
      setIsActivityRailResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const finishResize = (clientX: number) => {
        const nextWidth = clampActivityRailWidth(startWidth + clientX - startX);
        const expandedRailWidth = `calc(${nextWidth}px + var(--athas-workbench-gap))`;
        setActivityRailWidth(nextWidth);

        if (railRef.current) {
          railRef.current.style.width = expandedRailWidth;
        }

        if (railContentRef.current) {
          railContentRef.current.style.width = `${nextWidth}px`;
        }

        void updateSetting("activityRailWidth", nextWidth);
      };

      const handleMouseMove = (moveEvent: MouseEvent) => {
        previewActivityRailWidth(startWidth + moveEvent.clientX - startX);
      };

      const handleMouseUp = (upEvent: MouseEvent) => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = previousCursor;
        document.body.style.userSelect = previousUserSelect;
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        isResizingRef.current = false;
        setIsActivityRailResizing(false);
        finishResize(upEvent.clientX);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [activityRailWidth, expanded, previewActivityRailWidth, updateSetting],
  );

  const railPanelWidth = expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH;
  const settleProjectGesture = useCallback(
    async (offset: 1 | -1, requestedProjectId?: string) => {
      if (
        !projectCarouselEnabled ||
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length === 0 ||
        carouselProjectIndex < 0
      ) {
        return;
      }

      const targetIndex = requestedProjectId
        ? projectTabs.findIndex((project) => project.id === requestedProjectId)
        : getAdjacentProjectIndex(carouselProjectIndex, offset, projectTabs.length);
      if (targetIndex === null || targetIndex < 0) {
        projectGestureX.stop();
        projectGestureX.jump(0);
        return;
      }

      const targetProject = projectTabs[targetIndex];
      if (!targetProject || targetProject.id === carouselProject?.id) return;
      const targetWasReady = workspaceRuntimeRegistry.isWorkspaceReady(targetProject.id);

      isProjectGestureSettlingRef.current = true;
      if (requestedProjectId) {
        flushSync(() => {
          setProjectCarouselDirection(offset);
          setCarouselProjectId(targetProject.id);
          setCarouselTargetProjectId(null);
          setLoadingCarouselProjectId(targetWasReady ? null : targetProject.id);
          projectGestureX.jump(0);
        });

        try {
          await waitForProjectCarouselPaint();
          const switched = await switchToProject(targetProject.id);
          if (!switched) {
            flushSync(() => {
              setCarouselProjectId(activeProject?.id ?? null);
              setLoadingCarouselProjectId(null);
            });
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
        } finally {
          projectGestureX.jump(0);
          isProjectGestureSettlingRef.current = false;
        }
        return;
      }

      flushSync(() => {
        setProjectCarouselDirection(offset);
        setCarouselTargetProjectId(targetProject.id);
        setLoadingCarouselProjectId(targetWasReady ? null : targetProject.id);
      });

      try {
        projectGestureX.stop();
        if (prefersReducedMotion) {
          projectGestureX.jump(-offset * railPanelWidth);
        } else {
          const targetPosition = -offset * railPanelWidth;
          await animate(projectGestureX, targetPosition, {
            ...PROJECT_SNAP_TRANSITION,
            duration: getProjectSnapDuration(projectGestureX.get(), targetPosition, railPanelWidth),
          });
        }

        flushSync(() => {
          setCarouselProjectId(targetProject.id);
          setCarouselTargetProjectId(null);
          projectGestureX.jump(0);
        });
        await waitForProjectCarouselPaint();

        const switched = await switchToProject(targetProject.id);
        if (!switched) {
          flushSync(() => {
            setCarouselProjectId(activeProject?.id ?? null);
            setLoadingCarouselProjectId(null);
          });
          return;
        }

        if (!targetWasReady) {
          await waitForProjectCarouselPaint();
        }
        setLoadingCarouselProjectId(null);
      } catch {
        flushSync(() => {
          setCarouselProjectId(activeProject?.id ?? null);
          setCarouselTargetProjectId(null);
          setLoadingCarouselProjectId(null);
          projectGestureX.jump(0);
        });
      } finally {
        projectGestureX.jump(0);
        isProjectGestureSettlingRef.current = false;
      }
    },
    [
      activeProject?.id,
      carouselProject?.id,
      carouselProjectIndex,
      isActivityRailResizing,
      isSwitchingProject,
      prefersReducedMotion,
      projectGestureX,
      projectCarouselEnabled,
      projectTabs,
      railPanelWidth,
      switchToProject,
    ],
  );

  const returnProjectGestureToOrigin = useCallback(() => {
    projectGestureX.stop();
    if (prefersReducedMotion) {
      projectGestureX.jump(0);
      return;
    }
    void animate(projectGestureX, 0, {
      ...PROJECT_SNAP_TRANSITION,
      duration: getProjectSnapDuration(projectGestureX.get(), 0, railPanelWidth),
    });
  }, [prefersReducedMotion, projectGestureX, railPanelWidth]);

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      if (!projectCarouselEnabled || isSwitchingProject || isProjectGestureSettlingRef.current) {
        return;
      }

      const activeIndex = carouselProjectIndex;
      const targetIndex = projectTabs.findIndex((project) => project.id === projectId);
      if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return;

      const offset = getProjectCarouselDirection(activeIndex, targetIndex);
      if (!offset) return;
      void settleProjectGesture(offset, projectId);
    },
    [
      carouselProjectIndex,
      isSwitchingProject,
      projectCarouselEnabled,
      projectTabs,
      settleProjectGesture,
    ],
  );

  const finishProjectWheelGesture = useCallback(() => {
    projectWheelEndTimerRef.current = null;
    const position = projectGestureX.get();

    if (Math.abs(position) < PROJECT_SWIPE_THRESHOLD_PX) {
      returnProjectGestureToOrigin();
      return;
    }

    void settleProjectGesture(position < 0 ? 1 : -1);
  }, [projectGestureX, returnProjectGestureToOrigin, settleProjectGesture]);

  const handleProjectWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (
        !projectCarouselEnabled ||
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length === 0
      ) {
        return;
      }
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      event.preventDefault();
      projectGestureX.stop();
      const maximumTravel = (railContentRef.current?.clientWidth ?? railPanelWidth) * 0.96;
      const swipeBounds = getProjectSwipeBounds(
        Boolean(previousProject),
        Boolean(nextProject),
        maximumTravel,
      );
      const nextPosition = Math.min(
        swipeBounds.right,
        Math.max(swipeBounds.left, projectGestureX.get() - event.deltaX),
      );
      projectGestureX.jump(nextPosition);

      if (Math.abs(nextPosition) >= railPanelWidth * PROJECT_WHEEL_COMMIT_PROGRESS) {
        if (projectWheelEndTimerRef.current !== null) {
          clearTimeout(projectWheelEndTimerRef.current);
          projectWheelEndTimerRef.current = null;
        }
        void settleProjectGesture(nextPosition < 0 ? 1 : -1);
        return;
      }

      if (projectWheelEndTimerRef.current !== null) {
        clearTimeout(projectWheelEndTimerRef.current);
      }
      projectWheelEndTimerRef.current = setTimeout(
        finishProjectWheelGesture,
        PROJECT_WHEEL_END_DELAY_MS,
      );
    },
    [
      finishProjectWheelGesture,
      isActivityRailResizing,
      isSwitchingProject,
      nextProject,
      previousProject,
      projectCarouselEnabled,
      projectGestureX,
      projectTabs.length,
      railPanelWidth,
      settleProjectGesture,
    ],
  );

  const renderedRailWidth = `calc(${
    expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH
  }px + var(--athas-workbench-gap))`;
  const renderProjectPanel = (
    project: ProjectTab | undefined,
    position: "previous" | "current" | "next",
  ) => {
    const isBoundaryPanel = position !== "current" && !project;
    const isLoadingProject = project?.id === loadingCarouselProjectId;

    return (
      <div
        key={`${position}-${project?.id ?? "boundary"}`}
        aria-hidden={position === "current" ? undefined : true}
        inert={position === "current" ? undefined : true}
        className={cn(
          "absolute inset-y-0 left-0 flex w-full flex-col items-start gap-1 overflow-hidden pt-1.5",
          expanded && projectCarouselEnabled && showActivityRailProjectIcons ? "pb-7" : "pb-1.5",
          position !== "current" && "pointer-events-none",
        )}
        style={{
          boxSizing: "border-box",
          paddingLeft: ACTIVITY_RAIL_HORIZONTAL_GUTTER,
          paddingRight: ACTIVITY_RAIL_HORIZONTAL_GUTTER,
          transform:
            position === "previous"
              ? "translateX(-100%)"
              : position === "next"
                ? "translateX(100%)"
                : undefined,
        }}
      >
        {isBoundaryPanel ? null : (
          <>
            {showActivityRailProjectSwitcher ? (
              <SidebarProjectSwitcher
                expanded={expanded}
                project={project}
                projects={projectTabs}
                isSwitchingProject={isSwitchingProject}
                onSelectProject={handleProjectSelect}
              />
            ) : null}
            {isLoadingProject ? (
              <SidebarEmptyState className="min-h-0 flex-1 self-stretch">
                <Spinner
                  label={`Opening ${project?.name ?? "project"}`}
                  showLabel={expanded}
                  compact={!expanded}
                />
              </SidebarEmptyState>
            ) : (
              <div className="scrollbar-hidden min-h-0 w-full flex-1 overflow-y-auto">
                <SidebarPaneSelector
                  activeSidebarView={activeSidebarView}
                  isGitViewActive={isGitViewActive}
                  isGitHubPRsViewActive={isGitHubPRsViewActive}
                  isSidebarVisible={isSidebarVisible}
                  coreFeatures={coreFeatures}
                  onViewChange={handleSidebarViewChange}
                  onSearchClick={() => openGlobalSearchBuffer()}
                  onExtensionsClick={() => openExtensionsBuffer()}
                  isExtensionsActive={isExtensionsBufferActive}
                  compact={!expanded}
                  showLabels={expanded}
                  orientation="vertical"
                />
                <SidebarPinnedItems
                  expanded={expanded}
                  workspacePath={project?.path ?? null}
                  showAgents={showActivityRailAgentHistory}
                  showTerminals={coreFeatures.terminal && showActivityRailTerminals}
                />
                {showActivityRailAgentHistory ? (
                  <SidebarAgentHistory expanded={expanded} workspacePath={project?.path ?? null} />
                ) : null}
                {coreFeatures.terminal && showActivityRailTerminals ? (
                  <SidebarTerminalHistory expanded={expanded} />
                ) : null}
                {coreFeatures.git && showActivityRailWorktrees ? (
                  <SidebarWorktreeHistory
                    expanded={expanded}
                    repoPath={project?.path ?? null}
                    onNewWorktree={handleNewWorktree}
                  />
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={railRef}
        className={cn(
          "athas-sidebar-rail relative flex h-full shrink-0 overflow-hidden",
          !isActivityRailResizing &&
            "transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]",
        )}
        style={{
          width: renderedRailWidth,
        }}
      >
        <motion.div
          ref={railContentRef}
          onWheel={projectCarouselEnabled ? handleProjectWheel : undefined}
          className={cn(
            "absolute inset-y-0 left-0 shrink-0 will-change-transform",
            !isActivityRailResizing &&
              "transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]",
          )}
          style={{
            width: expanded
              ? railPanelWidth
              : `calc(${railPanelWidth}px + var(--athas-workbench-gap))`,
            x: projectGestureX,
          }}
        >
          {projectCarouselEnabled ? renderProjectPanel(renderedPreviousProject, "previous") : null}
          {renderProjectPanel(carouselProject, "current")}
          {projectCarouselEnabled ? renderProjectPanel(renderedNextProject, "next") : null}
        </motion.div>
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
            className="group absolute top-0 right-0 z-20 flex h-full w-[var(--athas-workbench-gap)] cursor-col-resize items-center justify-center hover:bg-primary/8"
            onMouseDown={handleResizeMouseDown}
          >
            <div className="h-full w-px bg-transparent transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:bg-primary" />
          </div>
        ) : null}
        {isActivityRailResizing ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuGroup>
          <ContextMenuLabel>Actions</ContextMenuLabel>
          <ContextMenuItem onClick={handleNewAgent}>
            <SparkleIcon />
            New Agent
          </ContextMenuItem>
          {coreFeatures.terminal ? (
            <ContextMenuItem onClick={handleNewTerminal}>
              <TerminalIcon />
              New Terminal
            </ContextMenuItem>
          ) : null}
          {coreFeatures.git ? (
            <ContextMenuItem onClick={handleNewWorktree}>
              <NodesIcon />
              New Worktree
            </ContextMenuItem>
          ) : null}
          <ContextMenuItem onClick={() => setIsProjectPickerVisible(true)}>
            <FolderOpenIcon />
            Open Project…
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openGlobalSearchBuffer()}>
            <MagnifyingGlassIcon />
            Search
          </ContextMenuItem>
          <ContextMenuItem onClick={() => openExtensionsBuffer()}>
            <ExtensionsIcon />
            Extensions
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <EyeIcon />
            Show in Activity Sidebar
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-56">
            <ContextMenuGroup>
              <ContextMenuLabel>Show in Activity Sidebar</ContextMenuLabel>
              <ContextMenuCheckboxItem
                checked={showActivityRailProjectSwitcher}
                onCheckedChange={(checked) =>
                  void updateSetting("showActivityRailProjectSwitcher", checked)
                }
              >
                <FolderIcon />
                Project Switcher
              </ContextMenuCheckboxItem>
              {activityRailVisibilityItems.map((item) => (
                <ContextMenuCheckboxItem
                  key={item.id}
                  checked={!hiddenSidebarActivityItems.includes(item.id)}
                  onCheckedChange={(checked) => setActivityRailItemVisible(item.id, checked)}
                >
                  {item.icon}
                  {item.label}
                </ContextMenuCheckboxItem>
              ))}
              <ContextMenuCheckboxItem
                checked={showActivityRailAgentHistory}
                onCheckedChange={(checked) =>
                  void updateSetting("showActivityRailAgentHistory", checked)
                }
              >
                <SparkleIcon />
                Agents
              </ContextMenuCheckboxItem>
              {coreFeatures.terminal ? (
                <ContextMenuCheckboxItem
                  checked={showActivityRailTerminals}
                  onCheckedChange={(checked) =>
                    void updateSetting("showActivityRailTerminals", checked)
                  }
                >
                  <TerminalIcon />
                  Terminals
                </ContextMenuCheckboxItem>
              ) : null}
              {coreFeatures.git ? (
                <ContextMenuCheckboxItem
                  checked={showActivityRailWorktrees}
                  onCheckedChange={(checked) =>
                    void updateSetting("showActivityRailWorktrees", checked)
                  }
                >
                  <NodesIcon />
                  Worktrees
                </ContextMenuCheckboxItem>
              ) : null}
              <ContextMenuCheckboxItem
                checked={showActivityRailProjectIcons}
                onCheckedChange={(checked) =>
                  void updateSetting("showActivityRailProjectIcons", checked)
                }
              >
                <FolderIcon />
                Project Dots
              </ContextMenuCheckboxItem>
            </ContextMenuGroup>
            {hasHiddenActivityRailItems ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={showAllActivityRailItems}>
                  <EyeIcon />
                  Show All
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export const MainSidebar = memo(
  ({ paneLevel = "primary", activeView, isGitActive, isGitHubPRsActive }: MainSidebarProps) => {
    const uiGitViewActive = useUIState((state) => state.isGitViewActive);
    const uiGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
    const uiActiveSidebarView = useUIState((state) => state.activeSidebarView);
    const isGitViewActive = isGitActive ?? uiGitViewActive;
    const isGitHubPRsViewActive = isGitHubPRsActive ?? uiGitHubPRsViewActive;
    const activeSidebarView = activeView ?? uiActiveSidebarView;
    const extensionViews = useExtensionViews();

    const handleFileSelect = useFileSystemStore.use.handleFileSelect?.();
    const rootFolderPath = useFileSystemStore.use.rootFolderPath?.();

    const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
    const hasTeamsCollaborationAccess = useAuthStore(
      (state) => state.subscription?.collaboration?.enabled === true,
    );
    const isCollaborationFeatureEnabled =
      hasTeamsCollaborationAccess && coreFeatures.teamCollaboration;
    const isOutlineFeatureEnabled = coreFeatures.outline;
    const activePaneId: SidebarView = isGitViewActive
      ? "git"
      : isGitHubPRsViewActive
        ? "github-prs"
        : activeSidebarView;
    const allPaneEntries: SidebarPaneEntry[] = [
      ...(coreFeatures.git
        ? [
            {
              id: "git" as const,
              content: (
                <GitView
                  repoPath={rootFolderPath}
                  onFileSelect={handleFileSelect}
                  isActive={isGitViewActive}
                />
              ),
            },
          ]
        : []),
      ...(coreFeatures.github
        ? [
            {
              id: "github-prs" as const,
              content: <GitHubPRsView />,
            },
          ]
        : []),
      ...(coreFeatures.docker
        ? [
            {
              id: "docker" as const,
              content: <DockerSidebar />,
            },
          ]
        : []),
      {
        id: "files",
        content: <FileExplorerPane />,
      },
      ...(isOutlineFeatureEnabled
        ? [
            {
              id: "outline" as const,
              content: <OutlineSidebar />,
            },
          ]
        : []),
      ...(isCollaborationFeatureEnabled
        ? [
            {
              id: "collaboration" as const,
              content: <CollaborationSidebarView />,
            },
          ]
        : []),
      ...Array.from(extensionViews).map(
        ([viewId, view]) =>
          ({
            id: viewId,
            content: (
              <ExtensionErrorBoundary extensionId={view.extensionId} name={view.title}>
                {view.render()}
              </ExtensionErrorBoundary>
            ),
          }) satisfies SidebarPaneEntry,
      ),
    ];
    const paneEntries = allPaneEntries.filter(
      (pane) => pane.id === activeSidebarView || getSidebarPaneLevel(pane.id) === paneLevel,
    );
    const activePane = (() => {
      const requestedIndex = paneEntries.findIndex((pane) => pane.id === activePaneId);
      if (requestedIndex >= 0) return paneEntries[requestedIndex];

      return paneEntries[0] ?? null;
    })();
    return (
      <div className="flex h-full min-h-0" data-external-file-drop-scope="sidebar">
        <SidebarPanel className={cn("min-w-0 flex-1 overflow-hidden bg-transparent")}>
          <div className="h-full min-h-0 overflow-hidden">{activePane?.content ?? null}</div>
        </SidebarPanel>
      </div>
    );
  },
);
