import {
  ArrowSquareUpIcon as ArrowSquareUp,
  CodeBlockIcon as CodeBlock,
  GearIcon as Gear,
  GearSixIcon as GearSix,
  GitBranchIcon as GitBranch,
  KeyboardIcon as Keyboard,
  PaintBrushIcon as PaintBrush,
  ShieldCheckIcon as ShieldCheck,
  SparkleIcon as Sparkle,
  TerminalWindowIcon as TerminalWindow,
  TreeStructureIcon as TreeStructure,
  UserCircleIcon as UserCircle,
  UsersThreeIcon as UsersThree,
} from "@/ui/icons";
import type { ComponentType, KeyboardEvent } from "react";
import { useUpgradeToPro } from "@/features/settings/hooks/use-upgrade-to-pro";
import { resolveSettingsAccess } from "@/features/settings/lib/settings-access";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { useProFeature } from "@/features/window/hooks/use-pro-feature";
import { Empty, EmptyDescription } from "@/ui/empty";
import { SidebarListItem, SidebarScrollArea } from "@/ui/sidebar";

interface SettingsVerticalTabsProps {
  activeTab: SettingsTab;
  activeSection?: string | null;
  onTabChange: (tab: SettingsTab) => void;
  onSectionChange?: (tab: SettingsTab, section: string) => void;
  panelIdForTab?: (tab: SettingsTab) => string;
}

export interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  sections?: string[];
  icon: ComponentType<{
    size?: string | number;
    className?: string;
    weight?: "regular" | "duotone";
  }>;
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  {
    id: "general",
    label: "General",
    icon: GearSix,
  },
  {
    id: "account",
    label: "Account",
    icon: UserCircle,
  },
  {
    id: "appearance",
    label: "Appearance",
    sections: ["Theme", "Typography", "Interface", "Layout"],
    icon: PaintBrush,
  },
  {
    id: "editor",
    label: "Editor",
    icon: CodeBlock,
  },
  {
    id: "file-explorer",
    label: "Files",
    sections: ["Display", "Behavior", "Filters"],
    icon: TreeStructure,
  },
  {
    id: "git",
    label: "Git",
    sections: ["Integration", "Git View", "Editor"],
    icon: GitBranch,
  },
  {
    id: "terminal",
    label: "Terminal",
    sections: ["Launch", "Profiles", "Typography", "Interaction", "Cursor"],
    icon: TerminalWindow,
  },
  {
    id: "keyboard",
    label: "Keybindings",
    icon: Keyboard,
  },
  {
    id: "ai",
    label: "Agent",
    sections: ["Notifications", "AI Chat", "Autocomplete", "Agent History"],
    icon: Sparkle,
  },
  {
    id: "collaboration",
    label: "Collaboration",
    icon: UsersThree,
  },
  {
    id: "enterprise",
    label: "Enterprise",
    sections: ["Enterprise Controls", "Extension Allowlist"],
    icon: ShieldCheck,
  },
  {
    id: "advanced",
    label: "Advanced",
    sections: ["Features", "Data", "Telemetry"],
    icon: Gear,
  },
];

export const SettingsVerticalTabs = ({
  activeTab,
  activeSection,
  onTabChange,
  onSectionChange,
  panelIdForTab = (tab) => `settings-panel-${tab}`,
}: SettingsVerticalTabsProps) => {
  const subscription = useAuthStore((state) => state.subscription);
  const { hasSettingsSync } = useProFeature();
  const { promptUpgrade } = useUpgradeToPro();
  const settingsAccess = resolveSettingsAccess(subscription);
  const visibleTabs = filterVisibleSettingsTabs(SETTINGS_TAB_ITEMS, {
    ...settingsAccess,
    matchingTabs: null,
  });

  const handleNavigationKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    const navigationItems = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "[data-settings-navigation-item]:not(:disabled)",
      ),
    );
    if (navigationItems.length === 0) return;

    event.preventDefault();
    const currentIndex = navigationItems.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? navigationItems.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + navigationItems.length) % navigationItems.length
            : (currentIndex - 1 + navigationItems.length) % navigationItems.length;
    navigationItems[nextIndex]?.focus();
    navigationItems[nextIndex]?.click();
  };

  return (
    <div
      data-slot="settings-sidebar-navigation"
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <SidebarScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportProps={{
          "aria-label": "Settings navigation",
        }}
      >
        <nav
          aria-label="Settings sections"
          className="flex w-full flex-col gap-chrome-tight"
          onKeyDown={handleNavigationKeyDown}
        >
          {visibleTabs.length > 0 ? (
            visibleTabs.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              const nestedSectionActive = item.sections?.includes(activeSection ?? "") ?? false;

              return (
                <div key={item.id} className="flex min-w-0 flex-col gap-chrome-tight">
                  <SidebarListItem
                    active={active && !nestedSectionActive}
                    leading={<Icon weight="duotone" />}
                    id={`settings-tab-${item.id}`}
                    aria-current={active && !nestedSectionActive ? "page" : undefined}
                    aria-controls={panelIdForTab(item.id)}
                    data-settings-navigation-item=""
                    onClick={() => onTabChange(item.id)}
                  >
                    {item.label}
                  </SidebarListItem>
                  {active && item.sections?.length ? (
                    <div
                      role="group"
                      aria-label={`${item.label} sections`}
                      data-slot="settings-sidebar-nested-sections"
                      className="flex min-w-0 flex-col gap-chrome-tight pl-5"
                    >
                      {item.sections.map((section) => {
                        const sectionActive = activeSection === section;

                        return (
                          <SidebarListItem
                            key={section}
                            active={sectionActive}
                            aria-current={sectionActive ? "location" : undefined}
                            data-settings-navigation-item=""
                            onClick={() => onSectionChange?.(item.id, section)}
                          >
                            {section}
                          </SidebarListItem>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <Empty className="min-h-0 flex-none rounded-none p-2">
              <EmptyDescription>No matching settings</EmptyDescription>
            </Empty>
          )}
        </nav>
      </SidebarScrollArea>

      {!hasSettingsSync ? (
        <div data-slot="settings-sidebar-footer" className="shrink-0 px-chrome-inline pb-2">
          <SidebarListItem leading={<ArrowSquareUp weight="duotone" />} onClick={promptUpgrade}>
            Upgrade to Pro
          </SidebarListItem>
        </div>
      ) : null}
    </div>
  );
};
