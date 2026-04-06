import { ChevronDown, ChevronRight, PenTool, Settings2, Shield, Sparkles } from "lucide-react";
import * as React from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useAuthStore } from "@/features/window/stores/auth-store";
import type { SettingsTab } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";

interface SettingsVerticalTabsProps {
  activeTab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

interface TabItem {
  id: SettingsTab;
  label: string;
}

interface TabGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  items: TabItem[];
}

const tabGroups: TabGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    icon: Settings2,
    items: [
      { id: "general", label: "General" },
      { id: "account", label: "Account" },
      { id: "appearance", label: "Appearance" },
      { id: "features", label: "Features" },
    ],
  },
  {
    id: "development",
    label: "Development",
    icon: PenTool,
    items: [
      { id: "editor", label: "Editor" },
      { id: "file-explorer", label: "File Explorer" },
      { id: "git", label: "Git" },
      { id: "terminal", label: "Terminal" },
      { id: "language", label: "Language" },
      { id: "keyboard", label: "Keybindings" },
      { id: "extensions", label: "Extensions" },
      { id: "databases", label: "Databases" },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    icon: Sparkles,
    items: [{ id: "ai", label: "AI" }],
  },
  {
    id: "administration",
    label: "System",
    icon: Shield,
    items: [
      { id: "enterprise", label: "Enterprise" },
      { id: "advanced", label: "Advanced" },
    ],
  },
];

const defaultExpandedGroups = ["workspace", "development", "intelligence"];

function getGroupIdForTab(tab: SettingsTab) {
  return tabGroups.find((group) => group.items.some((item) => item.id === tab))?.id ?? "workspace";
}

export const SettingsVerticalTabs = ({ activeTab, onTabChange }: SettingsVerticalTabsProps) => {
  const searchQuery = useSettingsStore((state) => state.search.query);
  const searchResults = useSettingsStore((state) => state.search.results);
  const subscription = useAuthStore((state) => state.subscription);
  const hasEnterpriseAccess = Boolean(subscription?.enterprise?.has_access);
  const [expandedGroups, setExpandedGroups] = React.useState<string[]>(() => {
    const activeGroupId = getGroupIdForTab(activeTab);
    return defaultExpandedGroups.includes(activeGroupId)
      ? defaultExpandedGroups
      : [...defaultExpandedGroups, activeGroupId];
  });

  // Get unique tabs from search results
  const matchingTabs = searchQuery ? [...new Set(searchResults.map((result) => result.tab))] : [];

  const availableGroups = tabGroups
    .map((group) => ({
      ...group,
      items: hasEnterpriseAccess
        ? group.items
        : group.items.filter((item) => item.id !== "enterprise"),
    }))
    .filter((group) => group.items.length > 0);

  const visibleGroups = searchQuery
    ? availableGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => matchingTabs.includes(item.id)),
        }))
        .filter((group) => group.items.length > 0)
    : availableGroups;

  const visibleTabs = visibleGroups.flatMap((group) => group.items);

  // Auto-select first visible tab when searching
  React.useEffect(() => {
    if (searchQuery && visibleTabs.length > 0) {
      const firstVisibleTab = visibleTabs[0].id;
      if (firstVisibleTab !== activeTab) {
        onTabChange(firstVisibleTab);
      }
    }
  }, [searchQuery, visibleTabs, activeTab, onTabChange]);

  React.useEffect(() => {
    if (searchQuery) return;

    const activeGroupId = availableGroups.find((group) =>
      group.items.some((item) => item.id === activeTab),
    )?.id;
    if (!activeGroupId || expandedGroups.includes(activeGroupId)) return;

    setExpandedGroups((current) => [...current, activeGroupId]);
  }, [searchQuery, availableGroups, activeTab, expandedGroups]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((current) =>
      current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId],
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-1 overflow-y-auto p-2">
        {visibleGroups.length > 0 ? (
          visibleGroups.map((group) => {
            const Icon = group.icon;
            const isExpanded = searchQuery ? true : expandedGroups.includes(group.id);
            const hasActiveItem = group.items.some((item) => item.id === activeTab);

            return (
              <div key={group.id} className="overflow-hidden rounded-xl">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleGroup(group.id)}
                  className={cn(
                    "ui-text-sm h-auto w-full justify-start gap-2 px-2.5 py-2 text-left",
                    hasActiveItem
                      ? "bg-accent/8 text-text"
                      : "text-text-lighter hover:bg-hover hover:text-text",
                  )}
                >
                  <Icon />
                  <span className="flex-1">{group.label}</span>
                  {isExpanded ? (
                    <ChevronDown className="shrink-0" />
                  ) : (
                    <ChevronRight className="shrink-0" />
                  )}
                </Button>

                {isExpanded ? (
                  <div className="relative mt-1 space-y-1 pl-6">
                    <div className="pointer-events-none absolute top-0 bottom-0 left-[17px] w-px bg-border/40" />
                    {group.items.map((item) => {
                      const isActive = activeTab === item.id;

                      return (
                        <Button
                          key={item.id}
                          type="button"
                          variant="ghost"
                          size="xs"
                          onClick={() => onTabChange(item.id)}
                          className={cn(
                            "ui-text-sm h-auto w-full justify-start px-2.5 py-1.5 text-left",
                            isActive
                              ? "bg-accent/10 text-accent"
                              : "text-text-lighter hover:bg-hover hover:text-text",
                          )}
                        >
                          <span>{item.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <div className="ui-font ui-text-sm p-2 text-center text-text-lighter">
            No matching settings
          </div>
        )}
      </div>
    </div>
  );
};
