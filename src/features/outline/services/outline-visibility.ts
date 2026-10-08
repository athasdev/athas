import { useSettingsStore } from "@/features/settings/stores/settings.store";

/** Shows or hides the outline panel docked beside each editor tab. */
export function setOutlineVisibilityPreference(visible: boolean) {
  const settingsState = useSettingsStore.getState();

  if (settingsState.settings.showOutline !== visible) {
    void settingsState.actions.updateSetting("showOutline", visible);
  }
}
