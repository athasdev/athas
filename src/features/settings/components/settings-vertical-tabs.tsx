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
} from "@phosphor-icons/react";
import { useCallback, useRef, type ComponentType, type WheelEvent } from "react";
import { useUpgradeToPro } from "@/features/settings/hooks/use-upgrade-to-pro";
import { resolveSettingsAccess } from "@/features/settings/lib/settings-access";
import { filterVisibleSettingsTabs } from "@/features/settings/lib/settings-tab-visibility";
import { useAuthStore } from "@/features/window/stores/auth.store";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { Button } from "@/ui/button";
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
  const { isPro } = useProFeature();
  const { promptUpgrade } = useUpgradeToPro();
  const settingsAccess = resolveSettingsAccess(subscription);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const visibleTabs = filterVisibleSettingsTabs(SETTINGS_TAB_ITEMS, {
    ...settingsAccess,
    matchingTabs: null,
  });

  const handleSidebarWheel = (event: WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const canScroll = container.scrollHeight > container.clientHeight;
    if (!canScroll || event.deltaY === 0) return;

    container.scrollTop += event.deltaY;
    event.preventDefault();
  };

  const focusTabAtIndex = useCallback(
    (index: number) => {
      const nextTab = visibleTabs[index];
      if (!nextTab) return;

      onTabChange(nextTab.id);
      window.requestAnimationFrame(() => {
        tabRefs.current[index]?.focus();
      });
    },
    [onTabChange, visibleTabs],
  );

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollContainerRef}
        role="tablist"
        aria-orientation="vertical"
        aria-label="Settings sections"
        className="flex-1 space-y-0.5 overflow-y-auto p-2"
        onWheelCapture={handleSidebarWheel}
      >
        {visibleTabs.length > 0 ? (
          visibleTabs.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;

            return (
              <Button
                key={item.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                variant="ghost"
                compact
                onClick={() => onTabChange(item.id)}
                onKeyDown={(event) => {
                  switch (event.key) {
                    case "ArrowDown":
                    case "ArrowRight":
                      event.preventDefault();
                      focusTabAtIndex((index + 1) % visibleTabs.length);
                      break;
                    case "ArrowUp":
                    case "ArrowLeft":
                      event.preventDefault();
                      focusTabAtIndex((index - 1 + visibleTabs.length) % visibleTabs.length);
                      break;
                    case "Home":
                      event.preventDefault();
                      focusTabAtIndex(0);
                      break;
                    case "End":
                      event.preventDefault();
                      focusTabAtIndex(visibleTabs.length - 1);
                      break;
                    default:
                      break;
                  }
                }}
                role="tab"
                id={`settings-tab-${item.id}`}
                aria-selected={isActive}
                aria-controls={panelIdForTab(item.id)}
                tabIndex={isActive ? 0 : -1}
                className={cn(
                  "ui-text-base h-auto w-full justify-start gap-2.5 rounded-[var(--app-radius-menu-item)] px-2.5 py-1.5 text-left",
                  isActive ? "bg-accent/10 text-accent" : "text-text hover:bg-hover",
                )}
              >
                <Icon className="size-[18px] shrink-0 text-current" weight="duotone" />
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })
        ) : (
          <div className="ui-font ui-text-base p-2 text-center text-text-lighter">
            No matching settings
          </div>
        )}
      </div>

      {!isPro ? (
        <div className="p-2">
          <Button
            type="button"
            variant="default"
            onClick={promptUpgrade}
            className="w-full justify-center border border-border/70"
            compact
          >
            <ArrowSquareUp className="size-4" weight="duotone" />
            Upgrade to Pro
          </Button>
        </div>
      ) : null}
    </div>
  );
};
