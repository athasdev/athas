import { convertFileSrc } from "@tauri-apps/api/core";
import {
  FolderIcon as Folder,
  HardDrivesIcon as HardDrives,
  PlusIcon as Plus,
} from "@phosphor-icons/react";
import { memo, type ReactNode } from "react";
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
import { SidebarPanel } from "@/ui/sidebar";
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
      className={cn(
        expanded
          ? "h-9 w-full justify-start gap-2 px-2.5"
          : "min-h-6 min-w-7 rounded-[var(--app-radius-control-sm)] px-0",
      )}
      aria-label="Switch project"
    >
      {icon}
      {expanded ? <span className="min-w-0 truncate">{projectName}</span> : null}
    </Button>
  );
}

export const SidebarActivityRail = memo(({ expanded = false }: SidebarActivityRailProps) => {
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const openExtensionsBuffer = useBufferStore.use.actions().openExtensionsBuffer;
  const isExtensionsBufferActive = useBufferStore((state) => {
    const activeBuffer = state.buffers.find((buffer) => buffer.id === state.activeBufferId);
    return activeBuffer?.type === "extensions";
  });
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const { openSidebarView } = useSidebarPaneController();

  const handleSidebarViewChange = (view: typeof activeSidebarView) => {
    openSidebarView(view);
  };

  return (
    <div
      className={cn(
        "athas-sidebar-rail flex shrink-0 flex-col items-start pb-1.5",
        expanded ? "w-40 px-1.5 pt-1" : "w-[3.5rem] px-0.5 pt-1",
      )}
    >
      <SidebarProjectSwitcher expanded={expanded} />
      <div className={cn("my-1 h-px shrink-0 bg-border/60", expanded ? "w-full" : "mx-auto w-7")} />
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
