import { convertFileSrc } from "@tauri-apps/api/core";
import {
  CaretUpDownIcon as CaretUpDown,
  FolderIcon as Folder,
  HardDrivesIcon as HardDrives,
  PlusIcon as Plus,
  SparkleIcon as Sparkles,
} from "@phosphor-icons/react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import { getRelativeTime } from "@/features/ai/lib/formatting";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
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
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { Button } from "@/ui/button";
import {
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionLabel,
} from "@/ui/sidebar";
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

const COLLAPSED_ACTIVITY_RAIL_WIDTH = 56;
const DEFAULT_ACTIVITY_RAIL_WIDTH = 180;
const MIN_ACTIVITY_RAIL_WIDTH = 140;
const MAX_ACTIVITY_RAIL_WIDTH = 320;
const ACTIVITY_RAIL_EXPANDED_PADDING_X = 12;

const clampActivityRailWidth = (width: number) =>
  Math.min(MAX_ACTIVITY_RAIL_WIDTH, Math.max(MIN_ACTIVITY_RAIL_WIDTH, Math.round(width)));

const getProjectNameFromPath = (path?: string) => {
  if (!path) return "Open Project";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
};

const isRemoteProjectPath = (path?: string) => path?.startsWith("remote://") === true;

function SidebarProjectSwitcher({ expanded }: { expanded: boolean }) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const activeProject = projectTabs.find((tab) => tab.isActive);
  const projectName = activeProject?.name || getProjectNameFromPath(rootFolderPath);
  const projectPath = activeProject?.path || rootFolderPath;
  const customIcon = activeProject?.customIcon;
  const isRemote = isRemoteProjectPath(projectPath);
  const rowClassName = expanded
    ? "h-9 w-full max-w-none justify-start gap-2.5 px-3 text-text"
    : "h-9 w-9 rounded-[var(--app-radius-control)] px-0";

  const icon = customIcon ? (
    <img
      src={convertFileSrc(customIcon)}
      alt=""
      className="size-4 shrink-0 rounded-[var(--app-radius-control-sm)] object-contain"
    />
  ) : isRemote ? (
    <HardDrives className="size-4" weight="duotone" />
  ) : projectPath ? (
    <Folder className="size-4" weight="duotone" />
  ) : (
    <Plus className="size-4" weight="duotone" />
  );

  return (
    <Button
      type="button"
      variant="ghost"
      tooltip={expanded ? undefined : projectName}
      tooltipSide="right"
      onClick={() => setIsProjectPickerVisible(true)}
      className={cn(rowClassName)}
      aria-label="Switch project"
    >
      {icon}
      {expanded ? (
        <>
          <span className="min-w-0 flex-1 truncate text-left">{projectName}</span>
          <CaretUpDown className="size-3.5 shrink-0 text-text-lighter" weight="bold" />
        </>
      ) : null}
    </Button>
  );
}

function SidebarNewAgentButton({ expanded }: { expanded: boolean }) {
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const createNewChat = useAIChatStore((state) => state.createNewChat);
  const selectedAgentId = useAIChatStore((state) => state.selectedAgentId);

  const handleNewAgent = useCallback(() => {
    const chatId = createNewChat(selectedAgentId);
    openAgentBuffer(chatId);
  }, [createNewChat, openAgentBuffer, selectedAgentId]);

  if (!expanded) {
    return (
      <SidebarHeaderIconButton
        tooltip="New Agent"
        tooltipSide="right"
        aria-label="New Agent"
        onClick={handleNewAgent}
      >
        <Sparkles />
      </SidebarHeaderIconButton>
    );
  }

  return (
    <SidebarListItem leading={<Sparkles />} onClick={handleNewAgent}>
      New Agent
    </SidebarListItem>
  );
}

function SidebarAgentHistory({ expanded }: { expanded: boolean }) {
  const chats = useAIChatStore((state) => state.chats);
  const currentChatId = useAIChatStore((state) => state.currentChatId);
  const switchToChat = useAIChatStore((state) => state.switchToChat);
  const openAgentBuffer = useBufferStore.use.actions().openAgentBuffer;
  const workspacePath = useWorkspaceTabsStore((state) => {
    const activeProject = state.projectTabs.find((tab) => tab.isActive);
    return activeProject?.path ?? null;
  });
  const recentChats = useMemo(
    () =>
      [...filterChatsByWorkspace(chats, workspacePath)]
        .sort((left, right) => right.lastMessageAt.getTime() - left.lastMessageAt.getTime())
        .slice(0, 4),
    [chats, workspacePath],
  );

  const handleOpenChat = useCallback(
    (chatId: string) => {
      switchToChat(chatId);
      openAgentBuffer(chatId);
    },
    [openAgentBuffer, switchToChat],
  );

  if (!expanded) {
    return <SidebarNewAgentButton expanded={false} />;
  }

  return (
    <div className="mt-2 w-full">
      <SidebarSectionLabel trailing={recentChats.length || undefined}>
        Agent History
      </SidebarSectionLabel>
      {recentChats.map((chat) => (
        <SidebarListItem
          key={chat.id}
          active={chat.id === currentChatId}
          description={(chat.agentId || "custom").replace(/-/g, " ")}
          trailing={getRelativeTime(chat.lastMessageAt)}
          onClick={() => handleOpenChat(chat.id)}
        >
          {chat.title}
        </SidebarListItem>
      ))}
      {recentChats.length === 0 ? <SidebarSectionLabel>No history yet</SidebarSectionLabel> : null}
      <SidebarNewAgentButton expanded />
    </div>
  );
}

export const SidebarActivityRail = memo(({ expanded = false }: SidebarActivityRailProps) => {
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const configuredActivityRailWidth = useSettingsStore((state) => state.settings.activityRailWidth);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [activityRailWidth, setActivityRailWidth] = useState(() =>
    clampActivityRailWidth(configuredActivityRailWidth || DEFAULT_ACTIVITY_RAIL_WIDTH),
  );
  const railRef = useRef<HTMLDivElement>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const isResizingRef = useRef(false);
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions";
  });
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
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
    };
  }, []);

  const previewActivityRailWidth = useCallback((nextWidth: number) => {
    const clampedWidth = clampActivityRailWidth(nextWidth);

    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
    }

    resizeFrameRef.current = requestAnimationFrame(() => {
      setActivityRailWidth(clampedWidth);

      if (railRef.current) {
        railRef.current.style.width = `${clampedWidth}px`;
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
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const finishResize = (clientX: number) => {
        const nextWidth = clampActivityRailWidth(startWidth + clientX - startX);
        setActivityRailWidth(nextWidth);

        if (railRef.current) {
          railRef.current.style.width = `${nextWidth}px`;
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
        finishResize(upEvent.clientX);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [activityRailWidth, expanded, previewActivityRailWidth, updateSetting],
  );

  return (
    <div
      ref={railRef}
      className={cn(
        "athas-sidebar-rail relative flex h-full shrink-0 flex-col pb-2 pt-2",
        expanded ? "items-start gap-1.5" : "items-center gap-1.5",
      )}
      style={{
        width: expanded ? activityRailWidth : COLLAPSED_ACTIVITY_RAIL_WIDTH,
        paddingLeft: expanded ? ACTIVITY_RAIL_EXPANDED_PADDING_X : 0,
        paddingRight: expanded ? ACTIVITY_RAIL_EXPANDED_PADDING_X : 0,
      }}
    >
      <SidebarProjectSwitcher expanded={expanded} />
      <SidebarPaneSelector
        activeSidebarView={activeSidebarView}
        isGitViewActive={isGitViewActive}
        isGitHubPRsViewActive={isGitHubPRsViewActive}
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
      {expanded ? (
        <div
          role="separator"
          aria-label="Resize activity rail"
          aria-orientation="vertical"
          className="absolute top-0 right-[-4px] z-20 h-full w-2 cursor-col-resize"
          onMouseDown={handleResizeMouseDown}
        />
      ) : null}
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
