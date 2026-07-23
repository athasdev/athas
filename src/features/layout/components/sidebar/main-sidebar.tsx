import { convertFileSrc } from "@tauri-apps/api/core";
import { animate, motion, useMotionValue, useReducedMotion, type PanInfo } from "framer-motion";
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
import { ResizeHandleEffect } from "@/features/layout/components/resize-handle-effect";
import { useSidebarPaneController } from "@/features/layout/hooks/use-sidebar-pane-controller";
import { getSidebarPaneLevel, type SidebarView } from "@/features/layout/utils/sidebar-pane-utils";
import { OutlineSidebar } from "@/features/outline/components/outline-sidebar";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import ProjectIconPicker from "@/features/window/components/project-icon-picker";
import { createAppWindow } from "@/features/window/utils/create-app-window";
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
  SidebarListEditor,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { InlineRenameInput } from "@/ui/input";
import {
  ChevronExpandYIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  OpenExternalIcon,
  PencilSimpleLineIcon,
  PlusIcon,
  RemoteIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { writeClipboardText } from "@/utils/clipboard";
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

const COLLAPSED_ACTIVITY_RAIL_WIDTH = 40;
const DEFAULT_ACTIVITY_RAIL_WIDTH = 160;
const MIN_ACTIVITY_RAIL_WIDTH = 140;
const MAX_ACTIVITY_RAIL_WIDTH = 320;
const ACTIVITY_RAIL_HORIZONTAL_GUTTER = 8;
const AGENT_HISTORY_INLINE_LIMIT = 5;
const PROJECT_SWIPE_THRESHOLD_PX = 42;
const PROJECT_SWIPE_VELOCITY_PX = 420;
const PROJECT_WHEEL_END_DELAY_MS = 80;
const PROJECT_SNAP_TRANSITION = {
  type: "spring" as const,
  stiffness: 720,
  damping: 56,
  mass: 0.42,
};

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
        className={cn("shrink-0 rounded-md object-contain", className ?? "size-4")}
      />
    );
  }

  const Icon = isRemote ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className ?? "size-4")} />;
}

function SidebarProjectSwitcher({
  expanded,
  project,
}: {
  expanded: boolean;
  project?: ProjectTab;
}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [detectedIconPath, setDetectedIconPath] = useState<string | undefined>();
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);
  const displayProject = project;
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
                "flex size-4 items-center justify-center rounded-md",
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

function SidebarProjectDots({
  projects,
  activeProjectId,
  isSwitchingProject,
  onSelectProject,
}: {
  projects: ProjectTab[];
  activeProjectId?: string;
  isSwitchingProject: boolean;
  onSelectProject: (projectId: string) => void;
}) {
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);

  if (projects.length === 0) return null;

  return (
    <>
      <div className="pointer-events-none absolute right-[var(--athas-workbench-gap)] bottom-1.5 left-0 z-20 flex justify-center px-2">
        <div className="scrollbar-hidden pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-secondary-bg/70 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          {projects.map((project) => {
            const isRemote = isRemoteProjectPath(project.path);
            const isActive = project.id === activeProjectId;

            return (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger
                  className="group/project-dot flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label={`${isActive ? "Current project" : "Switch to"} ${project.name}`}
                  aria-current={isActive ? "page" : undefined}
                  aria-disabled={isSwitchingProject}
                  title={project.name}
                  onClick={() => {
                    if (!isSwitchingProject) onSelectProject(project.id);
                  }}
                >
                  <span
                    className={cn(
                      "h-1.5 rounded-full transition-[width,background-color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)]",
                      isActive
                        ? "w-3 bg-accent"
                        : "w-1.5 bg-text-lighter/55 group-hover/project-dot:bg-text-lighter",
                    )}
                  />
                </ContextMenuTrigger>
                <ContextMenuContent side="top" sideOffset={6} align="center">
                  <ContextMenuItem
                    disabled={isActive || isSwitchingProject}
                    onClick={() => onSelectProject(project.id)}
                  >
                    <OpenExternalIcon />
                    Switch to Project
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => void writeClipboardText(project.path)}>
                    <CopyIcon />
                    Copy Path
                  </ContextMenuItem>
                  {!isRemote ? (
                    <ContextMenuItem
                      onClick={() =>
                        useFileSystemStore.getState().handleRevealInFolder?.(project.path)
                      }
                    >
                      <FolderOpenIcon />
                      Reveal in Finder
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuItem
                    onClick={() => {
                      if (isRemote) {
                        const match = project.path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
                        if (!match) return;
                        void createAppWindow({
                          remoteConnectionId: match[1],
                          remoteConnectionName: project.name,
                        });
                        return;
                      }

                      void createAppWindow({ path: project.path, isDirectory: true });
                    }}
                  >
                    <WindowExpandIcon />
                    Open in New Window
                  </ContextMenuItem>
                  {!isRemote ? (
                    <ContextMenuItem onClick={() => setIconPickerProject(project)}>
                      <ImageIcon />
                      Select Icon
                    </ContextMenuItem>
                  ) : null}
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    variant="destructive"
                    onClick={() => void closeProject(project.id)}
                  >
                    <TrashIcon />
                    Remove Project
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </div>
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

function SidebarAgentHistory({
  expanded,
  workspacePath,
}: {
  expanded: boolean;
  workspacePath: string | null;
}) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const deleteChat = useAIChatStore((state) => state.deleteChat);
  const updateChatTitle = useAIChatStore((state) => state.updateChatTitle);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [olderAgentsMenu, setOlderAgentsMenu] = useState({
    isOpen: false,
    position: { x: 0, y: 0 },
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

  const handleShowMoreAgents = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setOlderAgentsMenu({ isOpen: true, position: { x: rect.right + 6, y: rect.top } });
  }, []);

  const startRenamingChat = useCallback((chat: Chat) => {
    setRenamingChatId(chat.id);
    setRenameValue(chat.title);
  }, []);
  const olderAgentMenuItems = useMemo<MenuItem[]>(
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
      {visibleChats.map((chat) =>
        renamingChatId === chat.id ? (
          <SidebarListEditor
            key={chat.id}
            leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}
            trailing={getRelativeTime(chat.lastMessageAt)}
            className="ui-text-sm min-h-6 py-1"
          >
            <InlineRenameInput
              value={renameValue}
              onValueChange={setRenameValue}
              onSubmit={(nextTitle) => {
                if (nextTitle !== chat.title) {
                  updateChatTitle(chat.id, nextTitle);
                }
                setRenamingChatId(null);
              }}
              onCancel={() => setRenamingChatId(null)}
              aria-label={`Rename ${chat.title}`}
            />
          </SidebarListEditor>
        ) : (
          <ContextMenu key={chat.id}>
            <ContextMenuTrigger>
              <SidebarListItem
                active={chat.id === currentChatId}
                leading={<ProviderIcon providerId={chat.agentId || "custom"} size={16} />}
                trailing={getRelativeTime(chat.lastMessageAt)}
                onClick={() => handleOpenChat(chat.id)}
                className="ui-text-sm min-h-6 py-1"
              >
                {chat.title}
              </SidebarListItem>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => handleOpenChat(chat.id)}>
                <OpenExternalIcon />
                Open
              </ContextMenuItem>
              <ContextMenuItem onClick={() => startRenamingChat(chat)}>
                <PencilSimpleLineIcon />
                Rename
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={() => deleteChat(chat.id)}>
                <TrashIcon />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ),
      )}
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
      <Dropdown
        isOpen={olderAgentsMenu.isOpen}
        point={olderAgentsMenu.position}
        items={olderAgentMenuItems}
        onClose={() => setOlderAgentsMenu((current) => ({ ...current, isOpen: false }))}
        style={{ maxHeight: 320, width: 240 }}
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
  const [carouselProjectId, setCarouselProjectId] = useState<string | null>(null);
  const [carouselTargetProjectId, setCarouselTargetProjectId] = useState<string | null>(null);
  const [projectCarouselDirection, setProjectCarouselDirection] = useState<1 | -1>(1);
  const [isProjectGestureSettling, setIsProjectGestureSettling] = useState(false);
  const prefersReducedMotion = useReducedMotion();
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
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projectTabs.find((project) => project.isActive);
  const carouselProject =
    projectTabs.find((project) => project.id === carouselProjectId) ?? activeProject;
  const carouselProjectIndex = carouselProject
    ? projectTabs.findIndex((project) => project.id === carouselProject.id)
    : -1;
  const previousProject =
    carouselProjectIndex >= 0
      ? projectTabs[(carouselProjectIndex - 1 + projectTabs.length) % projectTabs.length]
      : undefined;
  const nextProject =
    carouselProjectIndex >= 0
      ? projectTabs[(carouselProjectIndex + 1) % projectTabs.length]
      : undefined;
  const carouselTargetProject = carouselTargetProjectId
    ? projectTabs.find((project) => project.id === carouselTargetProjectId)
    : undefined;
  const renderedPreviousProject =
    projectCarouselDirection < 0 && carouselTargetProject ? carouselTargetProject : previousProject;
  const renderedNextProject =
    projectCarouselDirection > 0 && carouselTargetProject ? carouselTargetProject : nextProject;
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
    if (isProjectGestureSettlingRef.current) return;
    setCarouselProjectId(activeProject?.id ?? null);
  }, [activeProject?.id]);

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
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length < 2 ||
        carouselProjectIndex < 0
      ) {
        return;
      }

      const targetIndex = requestedProjectId
        ? projectTabs.findIndex((project) => project.id === requestedProjectId)
        : (carouselProjectIndex + offset + projectTabs.length) % projectTabs.length;
      const targetProject = projectTabs[targetIndex];
      if (!targetProject || targetProject.id === carouselProject?.id) return;

      isProjectGestureSettlingRef.current = true;
      flushSync(() => {
        setProjectCarouselDirection(offset);
        setCarouselTargetProjectId(targetProject.id);
        setIsProjectGestureSettling(true);
      });

      projectGestureX.stop();
      if (prefersReducedMotion) {
        projectGestureX.jump(-offset * railPanelWidth);
      } else {
        await animate(projectGestureX, -offset * railPanelWidth, PROJECT_SNAP_TRANSITION);
      }

      flushSync(() => {
        setCarouselProjectId(targetProject.id);
        setCarouselTargetProjectId(null);
      });
      projectGestureX.jump(0);

      try {
        const switched = await switchToProject(targetProject.id);
        if (!switched) {
          flushSync(() => setCarouselProjectId(activeProject?.id ?? null));
        }
      } catch {
        flushSync(() => setCarouselProjectId(activeProject?.id ?? null));
      } finally {
        isProjectGestureSettlingRef.current = false;
        setIsProjectGestureSettling(false);
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
    void animate(projectGestureX, 0, PROJECT_SNAP_TRANSITION);
  }, [prefersReducedMotion, projectGestureX]);

  const handleProjectSelect = useCallback(
    (projectId: string) => {
      if (isSwitchingProject || isProjectGestureSettlingRef.current) return;

      const activeIndex = carouselProjectIndex;
      const targetIndex = projectTabs.findIndex((project) => project.id === projectId);
      if (activeIndex < 0 || targetIndex < 0 || activeIndex === targetIndex) return;

      const forwardDistance = (targetIndex - activeIndex + projectTabs.length) % projectTabs.length;
      const backwardDistance =
        (activeIndex - targetIndex + projectTabs.length) % projectTabs.length;
      const offset = forwardDistance <= backwardDistance ? 1 : -1;
      void settleProjectGesture(offset, projectId);
    },
    [carouselProjectIndex, isSwitchingProject, projectTabs, settleProjectGesture],
  );

  const handleProjectDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length < 2
      ) {
        return;
      }

      const shouldSwitch =
        Math.abs(info.offset.x) >= PROJECT_SWIPE_THRESHOLD_PX ||
        Math.abs(info.velocity.x) >= PROJECT_SWIPE_VELOCITY_PX;
      if (!shouldSwitch) {
        returnProjectGestureToOrigin();
        return;
      }

      const horizontalIntent =
        Math.abs(info.velocity.x) >= PROJECT_SWIPE_VELOCITY_PX ? info.velocity.x : info.offset.x;
      void settleProjectGesture(horizontalIntent < 0 ? 1 : -1);
    },
    [
      isActivityRailResizing,
      isSwitchingProject,
      projectTabs.length,
      returnProjectGestureToOrigin,
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
        isActivityRailResizing ||
        isSwitchingProject ||
        isProjectGestureSettlingRef.current ||
        projectTabs.length < 2
      ) {
        return;
      }
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      event.preventDefault();
      projectGestureX.stop();
      const maximumTravel = (railContentRef.current?.clientWidth ?? railPanelWidth) * 0.96;
      const nextPosition = Math.min(
        maximumTravel,
        Math.max(-maximumTravel, projectGestureX.get() - event.deltaX),
      );
      projectGestureX.jump(nextPosition);

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
      projectGestureX,
      projectTabs.length,
      railPanelWidth,
    ],
  );

  const renderedRailWidth = `calc(${
    expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH
  }px + var(--athas-workbench-gap))`;
  const canSwipeProjects =
    !isActivityRailResizing &&
    !isSwitchingProject &&
    !isProjectGestureSettling &&
    projectTabs.length > 1;

  const renderProjectPanel = (
    project: ProjectTab | undefined,
    position: "previous" | "current" | "next",
  ) => (
    <div
      key={`${position}-${project?.id ?? "welcome"}`}
      aria-hidden={position === "current" ? undefined : true}
      inert={position === "current" ? undefined : true}
      className={cn(
        "absolute inset-y-0 left-0 flex w-full flex-col items-start gap-1 overflow-hidden pt-1.5 pb-7",
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
      <SidebarProjectSwitcher expanded={expanded} project={project} />
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
      <SidebarAgentHistory expanded={expanded} workspacePath={project?.path ?? null} />
    </div>
  );

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
      <motion.div
        ref={railContentRef}
        drag={canSwipeProjects ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={1}
        dragMomentum={false}
        onDragEnd={handleProjectDragEnd}
        onWheel={handleProjectWheel}
        className={cn(
          "absolute inset-y-0 left-0 shrink-0 will-change-transform",
          canSwipeProjects && "cursor-grab active:cursor-grabbing",
          !isActivityRailResizing &&
            "transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]",
        )}
        style={{
          touchAction: "pan-y",
          width: expanded
            ? railPanelWidth
            : `calc(${railPanelWidth}px + var(--athas-workbench-gap))`,
          x: projectGestureX,
        }}
      >
        {renderProjectPanel(renderedPreviousProject, "previous")}
        {renderProjectPanel(carouselProject, "current")}
        {renderProjectPanel(renderedNextProject, "next")}
      </motion.div>
      {expanded ? (
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
          className="group absolute top-0 right-0 z-20 flex h-full w-[var(--athas-workbench-gap)] cursor-col-resize items-center justify-center hover:bg-accent/8"
          onMouseDown={handleResizeMouseDown}
        >
          <ResizeHandleEffect active={isActivityRailResizing} orientation="vertical" />
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
