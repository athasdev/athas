import { Activity, lazy, memo, type ReactNode, Suspense, useState } from "react";
import { FileExplorerPane } from "@/features/file-explorer/components/file-explorer-pane";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  getActiveSidebarView,
  getSidebarPaneLevel,
  type SidebarView,
} from "@/features/layout/utils/sidebar-pane-utils";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";

// Every view except the file tree loads on demand, so startup only parses the default one.
const GitView = lazy(() => import("@/features/git/components/git-view"));
const GitHubPRsView = lazy(() => import("@/features/github/components/github-prs-view"));
const ViewsSidebar = lazy(() =>
  import("@/features/views/components/views-sidebar").then((module) => ({
    default: module.ViewsSidebar,
  })),
);
const DockerSidebar = lazy(() =>
  import("@/features/docker/components/docker-sidebar").then((module) => ({
    default: module.DockerSidebar,
  })),
);
const CollaborationSidebarView = lazy(() =>
  import("@/features/collaboration/components/collaboration-sidebar").then((module) => ({
    default: module.CollaborationSidebarView,
  })),
);

// Loaded on demand so the layout does not pull the AI stores into its import graph.
const AgentContextSidebar = lazy(() =>
  import("@/features/ai/components/panel/agent-context-sidebar").then((module) => ({
    default: module.AgentContextSidebar,
  })),
);

const WorkspaceSidebar = lazy(() =>
  import("@/features/workspace/team/components/workspace-sidebar").then((module) => ({
    default: module.WorkspaceSidebar,
  })),
);

const AgentsSidebar = lazy(() =>
  import("@/features/ai/components/sidebar/agents-sidebar").then((module) => ({
    default: module.AgentsSidebar,
  })),
);
const DatabaseSidebar = lazy(() =>
  import("@/features/database/components/database-sidebar").then((module) => ({
    default: module.DatabaseSidebar,
  })),
);

interface SidebarPaneProps {
  visible?: boolean;
  paneLevel?: "primary" | "edge";
  activeView?: SidebarView;
  isGitActive?: boolean;
  isGitHubPRsActive?: boolean;
}

interface SidebarPaneEntry {
  id: SidebarView;
  content: ReactNode;
}

/** How many sidebar views stay mounted after the user switches away from them. */
const MAX_KEPT_SIDEBAR_VIEWS = 4;

export const SidebarPane = memo(
  ({
    visible = true,
    paneLevel = "primary",
    activeView,
    isGitActive,
    isGitHubPRsActive,
  }: SidebarPaneProps) => {
    const uiGitViewActive = useUIState((state) => state.isGitViewActive);
    const uiGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
    const uiActiveSidebarView = useUIState((state) => state.activeSidebarView);
    const isGitViewActive = isGitActive ?? uiGitViewActive;
    const isGitHubPRsViewActive = isGitHubPRsActive ?? uiGitHubPRsViewActive;
    const activeSidebarView = activeView ?? uiActiveSidebarView;
    const extensionViews = useExtensionViews();
    const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
    const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
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
                <Suspense fallback={null}>
                  <GitView
                    repoPath={rootFolderPath}
                    onFileSelect={handleFileSelect}
                    isActive={isGitViewActive}
                  />
                </Suspense>
              ),
            },
          ]
        : []),
      ...(coreFeatures.github
        ? [
            {
              id: "github-prs" as const,
              content: (
                <Suspense fallback={null}>
                  <GitHubPRsView />
                </Suspense>
              ),
            },
          ]
        : []),
      {
        id: "views",
        content: (
          <Suspense fallback={null}>
            <ViewsSidebar projectPath={rootFolderPath ?? null} />
          </Suspense>
        ),
      },
      ...(coreFeatures.docker
        ? [
            {
              id: "docker" as const,
              content: (
                <Suspense fallback={null}>
                  <DockerSidebar />
                </Suspense>
              ),
            },
          ]
        : []),
      {
        id: "workspaces",
        content: (
          <Suspense fallback={null}>
            <WorkspaceSidebar />
          </Suspense>
        ),
      },
      {
        id: "databases",
        content: (
          <Suspense fallback={null}>
            <DatabaseSidebar />
          </Suspense>
        ),
      },
      { id: "files", content: <FileExplorerPane /> },
      ...(coreFeatures.aiChat
        ? [
            {
              id: "agents" as const,
              content: (
                <Suspense fallback={null}>
                  <AgentsSidebar />
                </Suspense>
              ),
            },
          ]
        : []),
      {
        id: "agent",
        content: (
          <Suspense fallback={null}>
            <AgentContextSidebar />
          </Suspense>
        ),
      },
      ...(hasTeamsCollaborationAccess && coreFeatures.teamCollaboration
        ? [
            {
              id: "collaboration" as const,
              content: (
                <Suspense fallback={null}>
                  <CollaborationSidebarView />
                </Suspense>
              ),
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
    ].filter((pane) => pane.id === activeSidebarView || getSidebarPaneLevel(pane.id) === paneLevel);
    const activePane = paneEntries.find((pane) => pane.id === activePaneId) ?? paneEntries[0];
    const suspendWhenHidden =
      activePane &&
      [
        "files",
        "agents",
        "docker",
        "views",
        "github-prs",
        "agent",
        "workspaces",
        "databases",
      ].includes(activePane.id);

    // Recently shown views stay mounted but hidden, so switching back keeps their scroll, search
    // and loaded data instead of remounting into a loading state.
    const [recentPaneIds, setRecentPaneIds] = useState<string[]>([]);
    const nextRecentPaneIds = activePane
      ? [activePane.id, ...recentPaneIds.filter((id) => id !== activePane.id)]
          .filter((id) => paneEntries.some((pane) => pane.id === id))
          .slice(0, MAX_KEPT_SIDEBAR_VIEWS)
      : recentPaneIds;
    if (
      nextRecentPaneIds.length !== recentPaneIds.length ||
      nextRecentPaneIds.some((id, index) => id !== recentPaneIds[index])
    ) {
      setRecentPaneIds(nextRecentPaneIds);
    }

    return (
      <div className="flex h-full min-h-0" data-external-file-drop-scope="sidebar">
        {paneEntries
          .filter((pane) => nextRecentPaneIds.includes(pane.id))
          .map((pane) => {
            const isShown = pane.id === activePane?.id && (visible || !suspendWhenHidden);
            return (
              <Activity key={pane.id} mode={isShown ? "visible" : "hidden"}>
                <div className="h-full min-h-0 flex-1 overflow-hidden">{pane.content}</div>
              </Activity>
            );
          })}
      </div>
    );
  },
);
