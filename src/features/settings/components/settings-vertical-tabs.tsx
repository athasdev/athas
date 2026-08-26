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
import { SidebarListItem, SidebarPanel, SidebarScrollArea } from "@/ui/sidebar";

interface SettingsVerticalTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  panelIdForTab?: (tab: SettingsTab) => string;
}

export interface SettingsTabItem {
  id: SettingsTab;
  label: string;
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
    icon: TreeStructure,
  },
  {
    id: "git",
    label: "Git",
    icon: GitBranch,
  },
  {
    id: "terminal",
    label: "Terminal",
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
    icon: ShieldCheck,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Gear,
  },
];

export const SettingsVerticalTabs = ({
  activeTab,
  onTabChange,
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

    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
    );
    if (tabs.length === 0) return;

    event.preventDefault();
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : event.key === "ArrowDown"
            ? (currentIndex + 1 + tabs.length) % tabs.length
            : (currentIndex - 1 + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <SidebarPanel data-slot="settings-sidebar" className="bg-transparent">
      <SidebarScrollArea
        className="min-h-0 min-w-0 flex-1"
        viewportProps={{
          "aria-label": "Settings navigation",
        }}
      >
        <nav
          role="tablist"
          aria-label="Settings sections"
          aria-orientation="vertical"
          className="flex w-full flex-col gap-chrome-tight"
          onKeyDown={handleNavigationKeyDown}
        >
          {visibleTabs.length > 0 ? (
            visibleTabs.map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;

              return (
                <SidebarListItem
                  key={item.id}
                  active={active}
                  size="sm"
                  leading={<Icon weight="duotone" />}
                  id={`settings-tab-${item.id}`}
                  role="tab"
                  aria-selected={active}
                  aria-controls={panelIdForTab(item.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => onTabChange(item.id)}
                >
                  {item.label}
                </SidebarListItem>
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
          <SidebarListItem
            size="sm"
            leading={<ArrowSquareUp weight="duotone" />}
            onClick={promptUpgrade}
          >
            Upgrade to Pro
          </SidebarListItem>
        </div>
      ) : null}
    </SidebarPanel>
  );
};
