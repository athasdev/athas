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
import type { ComponentType } from "react";
import { useUpgradeToPro } from "@/features/settings/hooks/use-upgrade-to-pro";
import { resolveSettingsAccess } from "@/features/settings/lib/settings-access";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { Button } from "@/ui/button";
import { Empty, EmptyDescription } from "@/ui/empty";
import { ScrollArea } from "@/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/ui/tabs";
import { cn } from "@/utils/cn";

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

  return (
    <div data-slot="settings-sidebar" className="flex h-full min-h-0 min-w-0 flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onTabChange(value as SettingsTab)}
        orientation="vertical"
        className="min-h-0 flex-1 gap-0"
      >
        <ScrollArea
          className="min-h-0 min-w-0 flex-1"
          contentClassName="p-2"
          viewportProps={{
            "aria-label": "Settings navigation",
          }}
        >
          <TabsList
            variant="bare"
            aria-label="Settings sections"
            className="flex w-full flex-col items-stretch gap-0.5"
          >
            {visibleTabs.length > 0 ? (
              visibleTabs.map((item) => {
                const Icon = item.icon;

                return (
                  <TabsTrigger
                    key={item.id}
                    value={item.id}
                    size="md"
                    id={`settings-tab-${item.id}`}
                    aria-controls={panelIdForTab(item.id)}
                    className={cn(
                      "h-auto w-full justify-start gap-2.5 px-2.5 py-1.5 text-left",
                      activeTab === item.id
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-accent",
                    )}
                  >
                    <Icon className="size-4.5 shrink-0 text-current" weight="duotone" />
                    <span className="truncate">{item.label}</span>
                  </TabsTrigger>
                );
              })
            ) : (
              <Empty className="min-h-0 flex-none rounded-none p-2">
                <EmptyDescription>No matching settings</EmptyDescription>
              </Empty>
            )}
          </TabsList>
        </ScrollArea>
      </Tabs>

      {!hasSettingsSync ? (
        <div data-slot="settings-sidebar-footer" className="shrink-0 p-2">
          <Button
            type="button"
            variant="default"
            onClick={promptUpgrade}
            className="w-full justify-center"
            size="sm"
          >
            <ArrowSquareUp className="size-4" weight="duotone" />
            Upgrade to Pro
          </Button>
        </div>
      ) : null}
    </div>
  );
};
