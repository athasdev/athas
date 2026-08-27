import { memo, type ReactNode } from "react";
import { CollaborationSidebarView } from "@/features/collaboration/components/collaboration-sidebar";
import { DockerSidebar } from "@/features/docker/components/docker-sidebar";
import { FileExplorerPane } from "@/features/file-explorer/components/file-explorer-pane";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import GitView from "@/features/git/components/git-view";
import GitHubPRsView from "@/features/github/components/github-prs-view";
import {
  getActiveSidebarView,
  getSidebarPaneLevel,
  type SidebarView,
} from "@/features/layout/utils/sidebar-pane-utils";
import { OutlineSidebar } from "@/features/outline/components/outline-sidebar";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { ViewsSidebar } from "@/features/views/components/views-sidebar";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";

interface SidebarPaneProps {
  paneLevel?: "primary" | "edge";
  activeView?: SidebarView;
  isGitActive?: boolean;
  isGitHubPRsActive?: boolean;
}

interface SidebarPaneEntry {
  id: SidebarView;
  content: ReactNode;
}

export const SidebarPane = memo(
  ({ paneLevel = "primary", activeView, isGitActive, isGitHubPRsActive }: SidebarPaneProps) => {
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
    const activePaneId = getActiveSidebarView({
      isGitViewActive,
      isGitHubPRsViewActive,
      activeSidebarView,
    });

    const paneEntries: SidebarPaneEntry[] = [
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
      ...(coreFeatures.github ? [{ id: "github-prs" as const, content: <GitHubPRsView /> }] : []),
      { id: "views", content: <ViewsSidebar projectPath={rootFolderPath ?? null} /> },
      ...(coreFeatures.docker ? [{ id: "docker" as const, content: <DockerSidebar /> }] : []),
      { id: "files", content: <FileExplorerPane /> },
      ...(coreFeatures.outline ? [{ id: "outline" as const, content: <OutlineSidebar /> }] : []),
      ...(hasTeamsCollaborationAccess && coreFeatures.teamCollaboration
        ? [{ id: "collaboration" as const, content: <CollaborationSidebarView /> }]
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
    ].filter((pane) => pane.id === activeSidebarView || getSidebarPaneLevel(pane.id) === paneLevel);
    const activePane = paneEntries.find((pane) => pane.id === activePaneId) ?? paneEntries[0];

    return (
      <div className="flex h-full min-h-0" data-external-file-drop-scope="sidebar">
        <div className="h-full min-h-0 flex-1 overflow-hidden">{activePane?.content ?? null}</div>
      </div>
    );
  },
);
