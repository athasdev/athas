import type { ReactNode } from "react";
import {
  SETTINGS_TAB_GROUPS,
  type SettingsTabItem,
} from "@/features/settings/config/settings-tabs";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { Card } from "@/ui/card";
import { ScrollArea } from "@/ui/scroll-area";
import { SidebarListItem, SidebarSectionLabel } from "@/ui/sidebar";

interface SettingsNavigationProps {
  activeTab: SettingsTab;
  items: SettingsTabItem[];
  onTabChange: (tab: SettingsTab) => void;
  search: ReactNode;
}

export function SettingsNavigation({
  activeTab,
  items,
  onTabChange,
  search,
}: SettingsNavigationProps) {
  const itemsById = new Map(items.map((item) => [item.id, item]));

  return (
    <aside
      data-slot="settings-navigation"
      className="flex h-full w-64 shrink-0 p-3 @max-[760px]/settings:w-52"
    >
      <Card variant="elevated" className="h-full min-h-0 gap-0 py-0">
        <div className="shrink-0 px-3 pt-5 pb-3">
          <h1 className="px-1.5 font-semibold text-foreground ui-text-base">Settings</h1>
          <div className="mt-3">{search}</div>
        </div>

        <ScrollArea className="min-h-0 flex-1" contentClassName="px-3 pb-5">
          <nav aria-label="Settings sections">
            {SETTINGS_TAB_GROUPS.map((group) => {
              const groupItems = group.tabs
                .map((tab) => itemsById.get(tab))
                .filter((item): item is SettingsTabItem => Boolean(item));
              if (groupItems.length === 0) return null;

              return (
                <section key={group.id} className="pt-4 first:pt-0">
                  <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                  <div className="flex flex-col gap-0.5">
                    {groupItems.map((item) => {
                      const Icon = item.icon;

                      return (
                        <SidebarListItem
                          key={item.id}
                          id={`settings-tab-${item.id}`}
                          active={activeTab === item.id}
                          leading={<Icon weight="duotone" />}
                          onClick={() => onTabChange(item.id)}
                          aria-controls={`settings-panel-${item.id}`}
                          aria-current={activeTab === item.id ? "page" : undefined}
                        >
                          {item.label}
                        </SidebarListItem>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </nav>
        </ScrollArea>
      </Card>
    </aside>
  );
}
