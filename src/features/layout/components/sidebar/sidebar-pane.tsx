import { Activity, memo, type ReactNode, Suspense, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import {
  getActiveSidebarView,
  getSidebarPaneLevel,
} from "@/features/layout/utils/sidebar-pane-utils";
import type { SidebarView } from "@/features/layout/types/sidebar.types";
import { getSidebarViews } from "@/features/layout/services/sidebar-view-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { ExtensionErrorBoundary } from "@/extensions/ui/components/extension-error-boundary";
import { useExtensionViews } from "@/extensions/ui/hooks/use-extension-views";
import { useProjectStore } from "@/features/workspace/stores/project.store";

interface SidebarPaneProps {
  visible?: boolean;
  paneLevel?: "primary" | "edge";
  activeView?: SidebarView;
  isGitActive?: boolean;
  isGitHubPRsActive?: boolean;
}

interface SidebarPaneEntry {
  id: SidebarView;
  suspendWhenHidden: boolean;
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
    const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
    const coreFeatures = useSettingsStore((state) => state.settings.coreFeatures);
    const hasTeamsCollaborationAccess = useAuthStore(
      (state) => state.subscription?.collaboration?.enabled === true,
    );
    const activePaneId = getActiveSidebarView({
      isGitViewActive,
      isGitHubPRsViewActive,
      activeSidebarView,
    });

    const availability = { coreFeatures, hasTeamsCollaborationAccess };
    const paneEntries: SidebarPaneEntry[] = [
      ...getSidebarViews()
        .filter((view) => view.isAvailable?.(availability) ?? true)
        .map((view): SidebarPaneEntry => {
          const View = view.component;
          const props =
            view.getProps?.({
              rootFolderPath,
              onFileSelect: handleFileSelect,
              isActive: view.id === activePaneId,
            }) ?? {};
          return {
            id: view.id,
            suspendWhenHidden: view.suspendWhenHidden === true,
            content: view.loadsOnDemand ? (
              <Suspense fallback={null}>
                <View {...props} />
              </Suspense>
            ) : (
              <View {...props} />
            ),
          };
        }),
      ...Array.from(extensionViews).map(
        ([viewId, view]) =>
          ({
            id: viewId,
            suspendWhenHidden: false,
            content: (
              <ExtensionErrorBoundary extensionId={view.extensionId} name={view.title}>
                {view.render()}
              </ExtensionErrorBoundary>
            ),
          }) satisfies SidebarPaneEntry,
      ),
    ].filter((pane) => pane.id === activeSidebarView || getSidebarPaneLevel(pane.id) === paneLevel);
    const activePane = paneEntries.find((pane) => pane.id === activePaneId) ?? paneEntries[0];
    const suspendWhenHidden = activePane?.suspendWhenHidden;

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
