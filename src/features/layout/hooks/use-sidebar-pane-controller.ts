import { useCallback } from "react";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { resolveSidebarPaneClick } from "@/features/layout/utils/sidebar-pane-utils";
import type { SidebarView } from "@/features/layout/types/sidebar.types";

export function useSidebarPaneController() {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const setActiveView = useUIState((state) => state.setActiveView);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);

  const openSidebarView = useCallback(
    (view: SidebarView) => {
      const { nextIsSidebarVisible, nextView } = resolveSidebarPaneClick(
        {
          isSidebarVisible,
          isGitViewActive,
          isGitHubPRsViewActive,
          activeSidebarView,
        },
        view,
      );

      setActiveView(nextView);
      setIsSidebarVisible(nextIsSidebarVisible);
    },
    [
      activeSidebarView,
      isGitHubPRsViewActive,
      isGitViewActive,
      isSidebarVisible,
      setActiveView,
      setIsSidebarVisible,
    ],
  );

  return { openSidebarView };
}
