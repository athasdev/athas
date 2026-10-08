import { getSettingSearchTargetKey } from "@/features/settings/lib/settings-search";
import { useSettingsSearchStore } from "@/features/settings/stores/settings-search.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";

/**
 * Whether Settings was just asked to show `section`, by a deep link or a search result, so a
 * section that starts collapsed can open before the page scrolls to it.
 */
export function useSettingsSectionTarget(section: string) {
  const initialSection = useUIState((state) => state.settingsInitialSection);
  const searchSection = useSettingsSearchStore(
    (state) =>
      state.results.find((result) => result.id === state.selectedResultId)?.section ?? null,
  );
  const key = getSettingSearchTargetKey(section);
  return [initialSection, searchSection].some(
    (target) => target !== null && getSettingSearchTargetKey(target) === key,
  );
}
