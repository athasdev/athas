import { useCallback } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

type ActivitySidebarSection = "agents" | "terminals" | "worktrees";

export function useActivitySidebarSection(section: ActivitySidebarSection) {
  const collapsedSections = useSettingsStore(
    (state) => state.settings.collapsedActivityRailSections,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const isCollapsed = collapsedSections.includes(section);

  const toggleCollapsed = useCallback(() => {
    const currentSections = useSettingsStore.getState().settings.collapsedActivityRailSections;
    const nextSections = currentSections.includes(section)
      ? currentSections.filter((currentSection) => currentSection !== section)
      : [...currentSections, section];

    void updateSetting("collapsedActivityRailSections", nextSections);
  }, [section, updateSetting]);

  return { isCollapsed, toggleCollapsed };
}
