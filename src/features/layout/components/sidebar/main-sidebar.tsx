import { memo, type ReactNode } from "react";
import { CollaborationSidebarView } from "@/features/collaboration/components/collaboration-sidebar";
import { DockerSidebar } from "@/features/docker/components/docker-sidebar";
import { ExtensionsSidebar } from "@/features/extensions/components/extensions-sidebar";
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
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { SidebarPanel } from "@/ui/sidebar";
import { cn } from "@/utils/cn";

interface MainSidebarProps {
  showActivityRail?: boolean;
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
  compact?: boolean;
}

export const SidebarActivityRail = memo(({ compact = false }: SidebarActivityRailProps) => {
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const openGlobalSearchBuffer = useBufferStore.use.actions().openGlobalSearchBuffer;
  const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
  const { openSidebarView } = useSidebarPaneController();

  const handleSidebarViewChange = (view: typeof activeSidebarView) => {
    openSidebarView(view, { triggerSide: "current" });
  };

  return (
    <div
      className={cn(
        "athas-sidebar-rail flex shrink-0 items-start pb-1.5",
        compact ? "px-0.5 pt-1" : "px-1 pt-0",
      )}
    >
      <SidebarPaneSelector
        activeSidebarView={activeSidebarView}
        isGitViewActive={isGitViewActive}
        isGitHubPRsViewActive={isGitHubPRsViewActive}
        coreFeatures={coreFeatures}
        onViewChange={handleSidebarViewChange}
        onSearchClick={() => openGlobalSearchBuffer()}
        compact={compact}
        orientation="vertical"
      />
    </div>
  );
});

export const MainSidebar = memo(
  ({
    showActivityRail = true,
    paneLevel = "primary",
    activeView,
    isGitActive,
    isGitHubPRsActive,
  }: MainSidebarProps) => {
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
    const sidebarTabsPosition = useSettingsStore((state) => state.settings.sidebarTabsPosition);
    const hasTeamsCollaborationAccess = useAuthStore(
      (state) => state.subscription?.collaboration?.enabled === true,
    );
    const isCollaborationFeatureEnabled =
      hasTeamsCollaborationAccess && coreFeatures.teamCollaboration;
    const isOutlineFeatureEnabled = coreFeatures.outline;
    const showLeftSidebarTabs = sidebarTabsPosition === "left";
    const shouldRenderActivityRail = showActivityRail && showLeftSidebarTabs;
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
        id: "extensions",
        content: <ExtensionsSidebar />,
      },
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
        {shouldRenderActivityRail ? <SidebarActivityRail /> : null}

        <SidebarPanel
          framed={shouldRenderActivityRail}
          className={cn(
            "min-w-0 flex-1 overflow-hidden",
            !shouldRenderActivityRail && "bg-transparent",
          )}
        >
          <div className="h-full min-h-0 overflow-hidden">{activePane?.content ?? null}</div>
        </SidebarPanel>
      </div>
    );
  },
);
