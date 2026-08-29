import { GearSixIcon as Settings } from "@/ui/icons";
import { PathBreadcrumb } from "@/features/editor/components/toolbar/path-breadcrumb";
import { SETTINGS_TAB_ITEMS } from "@/features/settings/config/settings-tabs";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";

export function SettingsBreadcrumb({
  activeTab,
  onOpenRoot,
}: {
  activeTab: SettingsTab;
  onOpenRoot: () => void;
}) {
  const activeItem = SETTINGS_TAB_ITEMS.find((item) => item.id === activeTab);
  const ActiveIcon = activeItem?.icon;
  const showActiveCategory = activeTab !== "general" && Boolean(activeItem);
  const segments = showActiveCategory ? ["Settings", activeItem!.label] : ["Settings"];
  const icons = [
    <Settings key="settings" className="size-4" weight="duotone" />,
    ...(showActiveCategory && ActiveIcon
      ? [<ActiveIcon key={activeTab} className="size-4" weight="duotone" />]
      : []),
  ];

  return (
    <PathBreadcrumb
      ariaLabel="Settings path"
      segments={segments}
      icons={icons}
      interactive={(index) => index === 0 && showActiveCategory}
      onSegmentClick={(index) => {
        if (index === 0) onOpenRoot();
      }}
      className="flex-1"
    />
  );
}
