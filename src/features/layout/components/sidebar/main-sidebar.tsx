import { convertFileSrc } from "@tauri-apps/api/core";
import "./project-carousel.css";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Chat } from "@/features/ai/types/ai-chat.types";
import { ProviderIcon } from "@/features/ai/components/icons/provider-icons";
import { CollaborationSidebarView } from "@/features/collaboration/components/collaboration-sidebar";
import { DockerSidebar } from "@/features/docker/components/docker-sidebar";
import { FileExplorerPane } from "@/features/file-explorer/components/file-explorer-pane";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitView from "@/features/git/components/git-view";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import { SidebarPaneSelector } from "@/features/layout/components/sidebar/sidebar-pane-selector";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { getSidebarPaneLevel, type SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { OutlineSidebar } from "@/features/outline/components/outline-sidebar";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import ProjectIconPicker from "@/features/window/components/project-icon-picker";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  useWorkspaceTabsStore,
  type ProjectTab,
} from "@/features/window/stores/workspace-tabs.store";
import { findBestProjectIcon } from "@/features/window/utils/project-icons";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import {
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import {
  ChevronExpandYIcon,
  FolderIcon,
  OpenExternalIcon,
  PlusIcon,
  RemoteIcon,
  TrashIcon,
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

type ProjectCarouselAnimation = {
  direction: 1 | -1;
  phase: "exit" | "enter";
};

const COLLAPSED_ACTIVITY_RAIL_WIDTH = 40;
const DEFAULT_ACTIVITY_RAIL_WIDTH = 160;
const MIN_ACTIVITY_RAIL_WIDTH = 140;
const MAX_ACTIVITY_RAIL_WIDTH = 320;
const ACTIVITY_RAIL_HORIZONTAL_GUTTER = 8;
const AGENT_HISTORY_INLINE_LIMIT = 5;
const PROJECT_SWIPE_THRESHOLD_PX = 48;
const PROJECT_WHEEL_THRESHOLD_PX = 36;
const PROJECT_WHEEL_COOLDOWN_MS = 500;
const PROJECT_CAROUSEL_EXIT_MS = 120;
const PROJECT_CAROUSEL_ENTER_MS = 180;

const clampActivityRailWidth = (width: number) =>
  Math.min(MAX_ACTIVITY_RAIL_WIDTH, Math.max(MIN_ACTIVITY_RAIL_WIDTH, Math.round(width)));

const getProjectNameFromPath = (path?: string) => {
  if (!path) return "Open Project";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
};

const isRemoteProjectPath = (path?: string) => path?.startsWith("remote://") === true;

function ProjectGlyph({
  projectPath,
  iconPath,
  className,
}: {
  projectPath?: string;
  iconPath?: string;
  className?: string;
}) {
  const isRemote = isRemoteProjectPath(projectPath);

  if (iconPath) {
    return (
      <img
        src={convertFileSrc(iconPath)}
        alt=""
        className={cn(
          "shrink-0 rounded-[var(--app-radius-control-sm)] object-contain",
          className ?? "size-4",
        )}
      />
    );
  }

  const Icon = isRemote ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className ?? "size-4")} />;
}

function SidebarProjectSwitcher({
  expanded,
  displayProjectId,
}: {
  expanded: boolean;
  displayProjectId?: string | null;
}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [detectedIconPath, setDetectedIconPath] = useState<string | undefined>();
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const displayProject = displayProjectId
    ? (projectTabs.find((tab) => tab.id === displayProjectId) ?? activeProject)
    : activeProject;
  const projectName = displayProject?.name || getProjectNameFromPath(rootFolderPath);
  const projectPath = displayProject?.path || rootFolderPath;
  const customIcon = displayProject?.customIcon;
  const isRemote = isRemoteProjectPath(projectPath);
  const displayIconPath = customIcon ?? detectedIconPath;
  const displayProjectKey = displayProject?.id ?? projectPath;

  useEffect(() => {
    setDetectedIconPath(undefined);

    if (!displayProject || customIcon || isRemote || !projectPath) return;

    let cancelled = false;

    findBestProjectIcon(projectPath).then((iconFile) => {
      if (!cancelled) {
        setDetectedIconPath(iconFile?.path);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displayProject, displayProjectKey, customIcon, isRemote, projectPath]);

  const canChangeIcon = !!displayProject && !!projectPath && !isRemote;

  const handleOpenProjectPicker = useCallback(() => {
    setIsProjectPickerVisible(true);
  }, [setIsProjectPickerVisible]);

  const projectGlyph = <ProjectGlyph projectPath={projectPath} iconPath={displayIconPath} />;

  return (
    <>
      <SidebarListItem
        leading={
          expanded ? (
            <span
              role={canChangeIcon ? "button" : undefined}
              tabIndex={canChangeIcon ? 0 : undefined}
              aria-label={canChangeIcon ? "Change project icon" : undefined}
              className={cn(
                "flex size-4 items-center justify-center rounded-[var(--app-radius-control-sm)]",
                canChangeIcon &&
                  "hover:bg-hover/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/20",
              )}
              onClick={(event) => {
                if (!canChangeIcon || !displayProject) return;
                event.stopPropagation();
                setIconPickerProject(displayProject);
              }}
              onKeyDown={(event) => {
                if (!canChangeIcon || !displayProject) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setIconPickerProject(displayProject);
              }}
            >
              {projectGlyph}
            </span>
          ) : (
            projectGlyph
          )
        }
        iconOnly={!expanded}
        trailing={expanded ? <ChevronExpandYIcon className="size-3.5" /> : undefined}
        onClick={handleOpenProjectPicker}
        aria-label="Switch project"
        title={expanded ? undefined : projectName}
        className="ui-text-sm min-h-6 py-1"
      >
        {projectName}
      </SidebarListItem>
      {iconPickerProject ? (
        <ProjectIconPicker
          isOpen
          onClose={() => setIconPickerProject(null)}
          projectId={iconPickerProject.id}
          projectPath={iconPickerProject.path}
        />
      ) : null}
    </>
  );
}

function SidebarNewAgentButton({
  onCreate,
  iconOnlyRow = false,
}: {
  onCreate?: () => void;
  iconOnlyRow?: boolean;
}) {
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);

  const handleNewAgent = useCallback(() => {
    const chatId = createNewChat(selectedAgentId);
    onCreate?.();
    openAgentBuffer(chatId);
  }, [createNewChat, onCreate, openAgentBuffer, selectedAgentId]);

  return iconOnlyRow ? (
    <SidebarListItem
      leading={<PlusIcon className="size-4" />}
      iconOnly
      onClick={handleNewAgent}
      aria-label="New Agent"
      title="New Agent"
      className="ui-text-sm min-h-6 py-1"
    >
      New Agent
    </SidebarListItem>
  ) : (
    <SidebarHeaderIconButton
      tooltip="New Agent"
      tooltipSide="right"
      aria-label="New Agent"
      onClick={handleNewAgent}
    >
      <PlusIcon />
    </SidebarHeaderIconButton>
  );
}

function SidebarAgentHistory({ expanded }: { expanded: boolean }) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const deleteChat = useAIChatStore((state) => state.deleteChat);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const agentContextMenu = useContextMenu<Chat>();
  const olderAgentsMenu = useContextMenu();
  const workspacePath = useWorkspaceTabsStore((state) => {
    const activeProject = state.projectTabs.find((tab) => tab.isActive);
    return activeProject?.path ?? null;
  });
  const sortedChats = useMemo(
    () =>
      [...filterChatsByWorkspace(chats, workspacePath)].sort(
        (left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime(),
      ),
    [chats, workspacePath],
  );
  const visibleChats = useMemo(
    () => sortedChats.slice(0, AGENT_HISTORY_INLINE_LIMIT),
    [sortedChats],
  );
  const olderChats = useMemo(() => sortedChats.slice(AGENT_HISTORY_INLINE_LIMIT), [sortedChats]);

  const handleOpenChat = useCallback(
    (chatId: string) => {
      switchToChat(chatId);
      openAgentBuffer(chatId);
    },
    [openAgentBuffer, switchToChat],
  );

  const handleShowMoreAgents = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      olderAgentsMenu.openAt({ x: rect.right + 6, y: rect.top });
    },
    [olderAgentsMenu.openAt],
  );

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => {
    const chat = agentContextMenu.data;
    if (!chat) return [];

    return [
      {
        id: "open-agent-chat",
        label: "Open",
        icon: <OpenExternalIcon />,
        onClick: () => handleOpenChat(chat.id),
      },
      {
        id: "delete-agent-chat",
        label: "Delete",
        icon: <TrashIcon />,
        className: "hover:text-error",
        onClick: () => deleteChat(chat.id),
      },
    ];
  }, [agentContextMenu.data, deleteChat, handleOpenChat]);
  const olderAgentMenuItems = useMemo<ContextMenuItem[]>(
    () =>
      olderChats.map((chat) => ({
        id: chat.id,
        label: chat.title,
        icon: <ProviderIcon providerId={chat.agentId || "custom"} size={16} />,
        keybinding: getRelativeTime(chat.lastMessageAt),
        onClick: () => handleOpenChat(chat.id),
      })),
    [handleOpenChat, olderChats],
  );

  if (!expanded) {
    return <SidebarNewAgentButton iconOnlyRow />;
  }

  return (
    <div className="mt-1 w-full">
      <SidebarSectionLabel trailing={<SidebarNewAgentButton />}>Agents</SidebarSectionLabel>
      {visibleChats.map((chat) => (
        <SidebarListItem
          key={chat.id}
          active={chat.id === currentChatId}
          leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}
          trailing={getRelativeTime(chat.lastMessageAt)}
          onClick={() => handleOpenChat(chat.id)}
          onContextMenu={(event) => agentContextMenu.open(event, chat)}
          className="ui-text-sm min-h-6 py-1"
        >
          {chat.title}
        </SidebarListItem>
      ))}
      {olderChats.length > 0 ? (
        <SidebarListItem
          leading={<span className="size-4" aria-hidden="true" />}
          onClick={handleShowMoreAgents}
          className="ui-text-sm min-h-6 py-1"
        >
          Show more
        </SidebarListItem>
      ) : null}
      {visibleChats.length === 0 ? <SidebarSectionLabel>No history yet</SidebarSectionLabel> : null}
      <ContextMenu
        isOpen={olderAgentsMenu.isOpen}
        position={olderAgentsMenu.position}
        items={olderAgentMenuItems}
        onClose={olderAgentsMenu.close}
        style={{ maxHeight: 320, width: 240 }}
      />
      <ContextMenu
        isOpen={agentContextMenu.isOpen}
        position={agentContextMenu.position}
        items={contextMenuItems}
        onClose={agentContextMenu.close}
      />
    </div>
  );
}

export const SidebarActivityRail = memo(({ expanded = false }: SidebarActivityRailProps) => {
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const configuredActivityRailWidth = useSettingsStore((state) => state.settings.activityRailWidth);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [activityRailWidth, setActivityRailWidth] = useState(() =>
    clampActivityRailWidth(configuredActivityRailWidth || DEFAULT_ACTIVITY_RAIL_WIDTH),
  );
  const [isActivityRailResizing, setIsActivityRailResizing] = useState(false);
  const [projectCarouselAnimation, setProjectCarouselAnimation] =
    useState<ProjectCarouselAnimation | null>(null);
  const [displayProjectId, setDisplayProjectId] = useState<string | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const railContentRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const projectCarouselTimerRef = useRef<number | null>(null);
  const projectSwipeRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const projectWheelDeltaRef = useRef(0);
  const lastProjectWheelSwitchRef = useRef(0);
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions";
  });
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const switchToProject = useFileSystemStore((state) => state.switchToProject);
  const isSwitchingProject = useFileSystemStore((state) => state.isSwitchingProject);
  const { openSidebarView } = useSidebarPaneController();

  const handleSidebarViewChange = (view: typeof activeSidebarView) => {
    openSidebarView(view);
  };

  useEffect(() => {
    if (isResizingRef.current) return;
    setActivityRailWidth(
      clampActivityRailWidth(configuredActivityRailWidth || DEFAULT_ACTIVITY_RAIL_WIDTH),
    );
  }, [configuredActivityRailWidth]);

  useEffect(() => {
    return () => {
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      if (projectCarouselTimerRef.current !== null) {
        window.clearTimeout(projectCarouselTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (displayProjectId && projectTabs.some((project) => project.id === displayProjectId)) return;
    setDisplayProjectId(null);
  }, [displayProjectId, projectTabs]);

  const clearProjectCarouselTimer = useCallback(() => {
    if (projectCarouselTimerRef.current === null) return;
    window.clearTimeout(projectCarouselTimerRef.current);
    projectCarouselTimerRef.current = null;
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

  const switchProjectByOffset = useCallback(
    (offset: 1 | -1) => {
      if (isSwitchingProject || projectTabs.length < 2) return;

      const activeIndex = projectTabs.findIndex((project) => project.isActive);
      if (activeIndex < 0) return;

      const nextIndex = (activeIndex + offset + projectTabs.length) % projectTabs.length;
      const nextProject = projectTabs[nextIndex];
      if (!nextProject || nextProject.isActive) return;

      clearProjectCarouselTimer();
      setProjectCarouselAnimation({ direction: offset, phase: "exit" });

      projectCarouselTimerRef.current = window.setTimeout(() => {
        setDisplayProjectId(nextProject.id);
        void switchToProject(nextProject.id);
        setProjectCarouselAnimation({ direction: offset, phase: "enter" });

        projectCarouselTimerRef.current = window.setTimeout(() => {
          setProjectCarouselAnimation(null);
          setDisplayProjectId(null);
          projectCarouselTimerRef.current = null;
        }, PROJECT_CAROUSEL_ENTER_MS);
      }, PROJECT_CAROUSEL_EXIT_MS);
    },
    [clearProjectCarouselTimer, isSwitchingProject, projectTabs, switchToProject],
  );

  const projectCarouselClassName =
    projectCarouselAnimation === null
      ? undefined
      : projectCarouselAnimation.phase === "exit"
        ? projectCarouselAnimation.direction > 0
          ? "athas-project-carousel-exit-forward"
          : "athas-project-carousel-exit-back"
        : projectCarouselAnimation.direction > 0
          ? "athas-project-carousel-enter-forward"
          : "athas-project-carousel-enter-back";

  const handleProjectSwipeStart = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isActivityRailResizing || projectTabs.length < 2) return;

      projectSwipeRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
      };
    },
    [isActivityRailResizing, projectTabs.length],
  );

  const handleProjectSwipeEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const swipe = projectSwipeRef.current;
      projectSwipeRef.current = null;

      if (!swipe || swipe.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - swipe.startX;
      const deltaY = event.clientY - swipe.startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      if (absDeltaX < PROJECT_SWIPE_THRESHOLD_PX || absDeltaX <= absDeltaY * 1.25) {
        return;
      }

      switchProjectByOffset(deltaX < 0 ? 1 : -1);
    },
    [switchProjectByOffset],
  );

  const handleProjectSwipeCancel = useCallback(() => {
    projectSwipeRef.current = null;
  }, []);

  const handleProjectWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      if (isActivityRailResizing || isSwitchingProject || projectTabs.length < 2) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      const now = Date.now();
      if (now - lastProjectWheelSwitchRef.current < PROJECT_WHEEL_COOLDOWN_MS) return;

      projectWheelDeltaRef.current += event.deltaX;

      if (Math.abs(projectWheelDeltaRef.current) < PROJECT_WHEEL_THRESHOLD_PX) return;

      const offset = projectWheelDeltaRef.current > 0 ? 1 : -1;
      projectWheelDeltaRef.current = 0;
      lastProjectWheelSwitchRef.current = now;
      switchProjectByOffset(offset);
    },
    [isActivityRailResizing, isSwitchingProject, projectTabs.length, switchProjectByOffset],
  );

  const renderedRailWidth = `calc(${
    expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH
  }px + var(--athas-workbench-gap))`;
  const railContentWidth = expanded ? activityRailWidth : renderedRailWidth;

  return (
    <div
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
      <div
        ref={railContentRef}
        className={cn(
          "flex h-full shrink-0 flex-col overflow-hidden pb-1.5 pt-1.5",
          !isActivityRailResizing &&
            "transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]",
          "items-start gap-1",
          projectCarouselClassName,
        )}
        style={{
          boxSizing: "border-box",
          paddingLeft: ACTIVITY_RAIL_HORIZONTAL_GUTTER,
          paddingRight: ACTIVITY_RAIL_HORIZONTAL_GUTTER,
          touchAction: "pan-y",
          width: railContentWidth,
        }}
        onPointerDown={handleProjectSwipeStart}
        onPointerUp={handleProjectSwipeEnd}
        onPointerCancel={handleProjectSwipeCancel}
        onWheel={handleProjectWheel}
      >
        <SidebarProjectSwitcher expanded={expanded} displayProjectId={displayProjectId} />
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
        <SidebarAgentHistory expanded={expanded} />
      </div>
      {expanded ? (
        <div
          role="separator"
          aria-label="Resize activity rail"
          aria-orientation="vertical"
          className="group absolute top-0 right-0 z-20 flex h-full w-[var(--athas-workbench-gap)] cursor-col-resize items-center justify-center hover:bg-accent/8"
          onMouseDown={handleResizeMouseDown}
        >
          <div className="h-full w-px bg-transparent transition-colors duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] group-hover:bg-accent" />
        </div>
      ) : null}
      {isActivityRailResizing ? <div className="fixed inset-0 z-40 cursor-col-resize" /> : null}
    </div>
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
