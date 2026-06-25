import { useCallback } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  getSidebarPaneLevel,
  resolveSidebarPaneTrigger,
  type SidebarPaneLevel,
  type SidebarTriggerSide,
  type SidebarView,
} from "@/features/layout/utils/sidebar-pane-utils";

interface OpenSidebarViewOptions {
  paneLevel?: SidebarPaneLevel;
  triggerSide?: SidebarTriggerSide;
}

export function useSidebarPaneController() {
  const isSidebarVisible = useUIState((state) => state.isSidebarVisible);
  const isRightSidebarVisible = useUIState((state) => state.isRightSidebarVisible);
  const isGitViewActive = useUIState((state) => state.isGitViewActive);
  const isGitHubPRsViewActive = useUIState((state) => state.isGitHubPRsViewActive);
  const activeSidebarView = useUIState((state) => state.activeSidebarView);
  const activeRightSidebarView = useUIState((state) => state.activeRightSidebarView);
  const setActiveView = useUIState((state) => state.setActiveView);
  const setActiveRightSidebarView = useUIState((state) => state.setActiveRightSidebarView);
  const setIsSidebarVisible = useUIState((state) => state.setIsSidebarVisible);
  const setIsRightSidebarVisible = useUIState((state) => state.setIsRightSidebarVisible);
  const sidebarPosition = useSettingsStore((state) => state.settings.sidebarPosition);
  const updateSetting = useSettingsStore((state) => state.updateSetting);

  const openSidebarView = useCallback(
    (view: SidebarView, options: OpenSidebarViewOptions = {}) => {
      const paneLevel = options.paneLevel ?? getSidebarPaneLevel(view);

      if (paneLevel === "edge") {
        setActiveRightSidebarView(view);
        setIsRightSidebarVisible(!(isRightSidebarVisible && activeRightSidebarView === view));
        return;
      }

      const { nextIsSidebarVisible, nextView, nextPosition } = resolveSidebarPaneTrigger(
        {
          isSidebarVisible,
          isGitViewActive,
          isGitHubPRsViewActive,
          activeSidebarView,
        },
        view,
        {
          currentPosition: sidebarPosition,
          triggerSide: options.triggerSide,
        },
      );

      if (sidebarPosition !== nextPosition) {
        void updateSetting("sidebarPosition", nextPosition);
      }

      setActiveView(nextView);
      setIsSidebarVisible(nextIsSidebarVisible);
    },
    [
      activeSidebarView,
      activeRightSidebarView,
      isGitHubPRsViewActive,
      isGitViewActive,
      isRightSidebarVisible,
      isSidebarVisible,
      setActiveView,
      setActiveRightSidebarView,
      setIsSidebarVisible,
      setIsRightSidebarVisible,
      sidebarPosition,
      updateSetting,
    ],
  );

  return { openSidebarView };
}
