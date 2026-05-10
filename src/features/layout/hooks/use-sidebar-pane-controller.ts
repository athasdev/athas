import { useCallback } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
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
    isAgentSidebarVisible,
    isGitViewActive,
    isGitHubPRsViewActive,
    activeSidebarView,
    activeRightSidebarView,
    activeAgentSidebarView,
    setActiveView,
    setActiveRightSidebarView,
    setActiveAgentSidebarView,
    setIsSidebarVisible,
    setIsRightSidebarVisible,
    setIsAgentSidebarVisible,
  } = useUIState();
  const { settings, updateSetting } = useSettingsStore();

  const openSidebarView = useCallback(
    (view: SidebarView, options: OpenSidebarViewOptions = {}) => {
      const paneLevel = options.paneLevel ?? getSidebarPaneLevel(view);

      if (paneLevel === "edge") {
        setActiveRightSidebarView(view);
        setIsRightSidebarVisible(!(isRightSidebarVisible && activeRightSidebarView === view));
        if (activeAgentSidebarView === view) {
          setIsAgentSidebarVisible(false);
        }
        return;
      }

      if (paneLevel === "agent") {
        setActiveAgentSidebarView(view);
        setIsAgentSidebarVisible(!(isAgentSidebarVisible && activeAgentSidebarView === view));
        if (activeRightSidebarView === view) {
          setIsRightSidebarVisible(false);
        }
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
      activeAgentSidebarView,
      isGitHubPRsViewActive,
      isGitViewActive,
      isAgentSidebarVisible,
      isRightSidebarVisible,
      isSidebarVisible,
      setActiveAgentSidebarView,
      setActiveView,
      setActiveRightSidebarView,
      setIsAgentSidebarVisible,
      setIsSidebarVisible,
      setIsRightSidebarVisible,
      settings.sidebarPosition,
      updateSetting,
    ],
  );

  return { openSidebarView };
}
