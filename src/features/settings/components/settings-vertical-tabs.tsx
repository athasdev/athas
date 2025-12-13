import {
  Brush,
  Folder,
  Keyboard,
  Languages,
  Package,
  PenTool,
  Search,
  Settings,
  Settings2,
  Sparkles,
  Wrench,
} from "lucide-react";
import * as React from "react";
import { useSettingsStore } from "@/features/settings/store";
import type { SettingsTab } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

interface SettingsVerticalTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

interface TabItem {
  id: SettingsTab;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const tabs: TabItem[] = [
  {
    id: "general",
    label: "General",
    icon: Settings2,
  },
  {
    id: "editor",
    label: "Editor",
    icon: PenTool,
  },
  {
    id: "fileTree",
    label: "File Tree",
    icon: Folder,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Brush,
  },
  {
    id: "extensions",
    label: "Extensions",
    icon: Package,
  },
  {
    id: "ai",
    label: "AI",
    icon: Sparkles,
  },
  {
    id: "keyboard",
    label: "Keybindings",
    icon: Keyboard,
  },
  {
    id: "language",
    label: "Language",
    icon: Languages,
  },
  {
    id: "features",
    label: "Features",
    icon: Settings,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: Wrench,
  },
];

export const SettingsVerticalTabs = ({ activeTab, onTabChange }: SettingsVerticalTabsProps) => {
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const setSearchQuery = useSettingsStore((state) => state.setSearchQuery);

  // Get unique tabs from search results
  const matchingTabs = searchQuery ? [...new Set(searchResults.map((result) => result.tab))] : [];

  // Filter tabs based on search
  const visibleTabs = searchQuery ? tabs.filter((tab) => matchingTabs.includes(tab.id)) : tabs;

  // Auto-select first visible tab when searching
  React.useEffect(() => {
    if (searchQuery && visibleTabs.length > 0) {
      const firstVisibleTab = visibleTabs[0].id;
      if (firstVisibleTab !== activeTab) {
        onTabChange(firstVisibleTab);
      }
    }
  }, [searchQuery, visibleTabs, activeTab, onTabChange]);

  return (
    <div className="flex h-full flex-col">
      {/* Search Input */}
      <div className="border-border border-b p-2">
        <div className="relative">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2 text-text-lighter"
            size={12}
          />
          <input
            type="text"
            placeholder="Search settings..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ui-font w-full rounded border border-border bg-primary-bg py-1 pr-6 pl-7 text-text text-xs placeholder:text-text-lighter"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-y-auto p-1.5">
        {visibleTabs.length > 0 ? (
          visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition-colors",
                  isActive
                    ? "border-blue-500/30 bg-blue-500/20 text-blue-400"
                    : "border-transparent text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            );
          })
        ) : (
          <div className="p-2 text-center text-text-lighter text-xs">No matching tabs</div>
        )}
      </div>
    </div>
  );
};
