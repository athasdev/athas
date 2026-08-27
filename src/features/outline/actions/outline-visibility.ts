import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";

export function applyOutlineVisibilityPreference(visible: boolean) {
  const uiState = useUIState.getState();

  if (visible) {
    uiState.setActiveRightSidebarView("outline");
    uiState.setIsRightSidebarVisible(true);
    return;
  }

  if (uiState.activeRightSidebarView === "outline") {
    uiState.setIsRightSidebarVisible(false);
  }
}

export function setOutlineVisibilityPreference(visible: boolean) {
  const settingsState = useSettingsStore.getState();

  if (settingsState.settings.showOutline !== visible) {
    void settingsState.actions.updateSetting("showOutline", visible);
  }

  applyOutlineVisibilityPreference(visible);
}
