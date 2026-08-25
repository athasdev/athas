import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
} from "react";
import { flushSync } from "react-dom";
import { ViewsSidebar } from "@/features/views/components/views-sidebar";
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
  getProjectCarouselPageIndex,
  getProjectCarouselWindow,
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
import { SidebarPanel } from "@/ui/sidebar";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
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
  GithubLogoIcon,
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
const PROJECT_SCROLL_SETTLE_DELAY_MS = 120;

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
  const [loadingCarouselProjectId, setLoadingCarouselProjectId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railContentRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const isProjectGestureSettlingRef = useRef(false);
  const projectScrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const extensionViews = useExtensionViews();
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
  const railPanelWidth = expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH;
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
              icon: <GithubLogoIcon />,
            },
          ]
        : []),
      {
        id: "views",
        label: "Views",
        icon: <SparkleIcon />,
      },
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

  const alignProjectCarouselToCurrent = useCallback(() => {
    const container = railContentRef.current;
    const currentPanel = container?.querySelector<HTMLElement>(
      '[data-project-carousel-current="true"]',
    );
    if (!container || !currentPanel) return;
    container.scrollLeft = currentPanel.offsetLeft;
  }, []);

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
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      if (projectScrollEndTimerRef.current !== null) {
        clearTimeout(projectScrollEndTimerRef.current);
      }
    };
  }, []);

  const previewActivityRailWidth = useCallback(
    (nextWidth: number) => {
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
          alignProjectCarouselToCurrent();
        }

        resizeFrameRef.current = null;
      });
    },
    [alignProjectCarouselToCurrent],
  );

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
          />
        ) : null}
        {isLoadingProject ? (
          <div className="flex min-h-0 flex-1 self-stretch items-center justify-center">
            <Spinner label={`Opening ${project.name}`} showLabel={expanded} compact={!expanded} />
          </div>
        ) : (
          <div className="flex min-h-0 w-full flex-1 flex-col">
            <div className="scrollbar-none min-h-0 w-full flex-1 overflow-y-auto">
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
                workspacePath={project.path}
                showAgents={showActivityRailAgentHistory}
                showTerminals={coreFeatures.terminal && showActivityRailTerminals}
              />
              {showActivityRailAgentHistory ? (
                <SidebarAgentHistory expanded={expanded} workspacePath={project.path} />
              ) : null}
              {coreFeatures.terminal && showActivityRailTerminals ? (
                <SidebarTerminalHistory expanded={expanded} />
              ) : null}
              {coreFeatures.git && showActivityRailWorktrees ? (
                <SidebarWorktreeHistory
                  expanded={expanded}
                  repoPath={project.path}
                  onNewWorktree={handleNewWorktree}
                />
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
        className="athas-sidebar-rail relative flex h-full shrink-0 overflow-hidden"
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
            onMouseDown={handleResizeMouseDown}
          >
            <div className="h-full w-px bg-transparent transition-colors duration-fast ease-smooth group-hover:bg-primary" />
          </div>
        ) : null}
        {isActivityRailResizing ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-56">
        <ContextMenuGroup>
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
            Visible Items
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="min-w-56">
            <ContextMenuGroup>
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
      {
        id: "views",
        content: <ViewsSidebar projectPath={rootFolderPath ?? null} />,
      },
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
        <SidebarPanel className="min-w-0 flex-1 overflow-hidden bg-transparent">
          <div className="h-full min-h-0 overflow-hidden">{activePane?.content ?? null}</div>
        </SidebarPanel>
      </div>
    );
  },
);
