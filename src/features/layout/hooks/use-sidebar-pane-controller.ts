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
  const {
    isSidebarVisible,
    isRightSidebarVisible,
    isGitViewActive,
    isGitHubPRsViewActive,
    activeSidebarView,
    activeRightSidebarView,
    setActiveView,
    setActiveRightSidebarView,
    setIsSidebarVisible,
    setIsRightSidebarVisible,
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();

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
          currentPosition: settings.sidebarPosition,
          triggerSide: options.triggerSide,
        },
      );

      if (settings.sidebarPosition !== nextPosition) {
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
      settings.sidebarPosition,
      updateSetting,
    ],
  );

  return { openSidebarView };
}
