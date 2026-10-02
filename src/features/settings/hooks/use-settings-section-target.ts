import { getSettingSearchTargetKey } from "@/features/settings/lib/settings-search";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/window/stores/ui-state.store";

/**
 * Whether Settings was just asked to show `section`, by a deep link or a search result, so a
 * section that starts collapsed can open before the page scrolls to it.
 */
export function useSettingsSectionTarget(section: string) {
  const initialSection = useUIState((state) => state.settingsInitialSection);
  const searchSection = useSettingsStore(
    (state) =>
      state.search.results.find((result) => result.id === state.search.selectedResultId)?.section ??
      null,
  );
  const key = getSettingSearchTargetKey(section);
  return [initialSection, searchSection].some(
    (target) => target !== null && getSettingSearchTargetKey(target) === key,
  );
}
