import { useCallback, type ReactNode } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  isActivitySidebarSectionCollapsed,
  toggleActivitySidebarSection,
  type ActivitySidebarSectionId,
} from "@/features/layout/utils/activity-sidebar-sections";
import { SidebarSectionHeader, SidebarSectionStack } from "@/ui/sidebar";

interface ActivitySidebarSectionProps {
  id: ActivitySidebarSectionId;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export function ActivitySidebarSection({
  id,
  title,
  action,
  children,
}: ActivitySidebarSectionProps) {
  const collapsedSections = useSettingsStore(
    (state) => state.settings.collapsedActivityRailSections,
  );
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const collapsed = isActivitySidebarSectionCollapsed(collapsedSections, id);
  const toggle = useCallback(() => {
    const currentSections = useSettingsStore.getState().settings.collapsedActivityRailSections;
    void updateSetting(
      "collapsedActivityRailSections",
      toggleActivitySidebarSection(currentSections, id),
    );
  }, [id, updateSetting]);

  return (
    <SidebarSectionStack>
      <SidebarSectionHeader expanded={!collapsed} onToggle={toggle} action={action}>
        {title}
      </SidebarSectionHeader>
      {collapsed ? null : children}
    </SidebarSectionStack>
  );
}
