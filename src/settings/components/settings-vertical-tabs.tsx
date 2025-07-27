import {
  Keyboard,
  Languages,
  Monitor,
  PenTool,
  Settings,
  Settings2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { cn } from "@/utils/cn";
import type { SettingsTab } from "./settings-dialog";

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
    id: "theme",
    label: "Theme",
    icon: Monitor,
  },
  {
    id: "ai",
    label: "AI",
    icon: Sparkles,
  },
  {
    id: "keyboard",
    label: "Keyboard",
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
  return (
    <div className="p-1.5">
      {tabs.map((tab) => {
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
      })}
    </div>
  );
};
