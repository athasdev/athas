import {
  ArrowSquareUp,
  CodeBlock,
  Database,
  Gear,
  GearSix,
  GitBranch,
  Keyboard,
  PaintBrush,
  PuzzlePiece,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  TerminalWindow,
  TreeStructure,
  UserCircle,
} from "@phosphor-icons/react";
import * as React from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useUpgradeToPro } from "@/features/settings/hooks/use-upgrade-to-pro";
import { useAuthStore } from "@/features/window/stores/auth-store";
import type { SettingsTab } from "@/features/window/stores/ui-state-store";
import { useProFeature } from "@/extensions/ui/hooks/use-pro-feature";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SettingsVerticalTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  panelIdForTab?: (tab: SettingsTab) => string;
}

interface TabItem {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{
    size?: string | number;
    className?: string;
    weight?: "regular" | "duotone";
  }>;
}

const tabItems: TabItem[] = [
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
    id: "features",
    label: "Features",
    icon: SlidersHorizontal,
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
    id: "extensions",
    label: "Extensions",
    icon: PuzzlePiece,
  },
  {
    id: "databases",
    label: "Database",
    icon: Database,
  },
  {
    id: "ai",
    label: "AI",
    icon: Sparkle,
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
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const subscription = useAuthStore((state) => state.subscription);
  const { isPro } = useProFeature();
  const { promptUpgrade } = useUpgradeToPro();
  const hasEnterpriseAccess = Boolean(subscription?.enterprise?.has_access);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const matchingTabs = searchQuery ? new Set(searchResults.map((result) => result.tab)) : null;

  const visibleTabs = tabItems.filter((item) => {
    if (!hasEnterpriseAccess && item.id === "enterprise") {
      return false;
    }

    if (!matchingTabs) {
      return true;
    }

    return matchingTabs.has(item.id);
  });

  React.useEffect(() => {
    if (searchQuery && visibleTabs.length > 0) {
      const firstVisibleTab = visibleTabs[0].id;
      if (firstVisibleTab !== activeTab) {
        onTabChange(firstVisibleTab);
      }
    }
  }, [searchQuery, visibleTabs, activeTab, onTabChange]);

  const handleSidebarWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const canScroll = container.scrollHeight > container.clientHeight;
    if (!canScroll || event.deltaY === 0) return;

    container.scrollTop += event.deltaY;
    event.preventDefault();
  };

  const focusTabAtIndex = React.useCallback(
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
                size="sm"
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
                  "ui-text-sm h-auto w-full justify-start gap-2.5 rounded-xl px-2.5 py-1.5 text-left",
                  isActive ? "bg-accent/10 text-accent" : "text-text hover:bg-hover",
                )}
              >
                <Icon className="size-[18px] shrink-0 text-current" weight="duotone" />
                <span className="truncate">{item.label}</span>
              </Button>
            );
          })
        ) : (
          <div className="ui-font ui-text-sm p-2 text-center text-text-lighter">
            No matching settings
          </div>
        )}
      </div>

      {!isPro ? (
        <div className="p-2">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={promptUpgrade}
            className="w-full justify-center border border-border/70"
          >
            <ArrowSquareUp className="size-4" weight="duotone" />
            Upgrade to Pro
          </Button>
        </div>
      ) : null}
    </div>
  );
};
