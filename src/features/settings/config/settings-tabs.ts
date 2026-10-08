import {
  UploadIcon,
  BellIcon,
  CodeBlockIcon,
  GearIcon,
  GitBranchIcon,
  type Icon,
  KeyboardIcon,
  KeyIcon,
  PaintBrushIcon,
  PlugsConnectedIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SitemapIcon,
  SparkleIcon,
  TerminalWindowIcon,
  TextIndentIcon,
  ChatBubbleTextIcon,
  UserCircleIcon,
  UsersIcon,
} from "@/ui/icons";
import type { SettingsTab } from "@/features/layout/stores/ui-state/types/ui-state.types";
import type { SettingsSection } from "@/features/settings/types/settings.types";

export interface SettingsTabItem {
  id: SettingsSection;
  label: string;
  /** A shorter name for the settings sidebar, where the page's group already names it. */
  navigationLabel?: string;
  icon: Icon;
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  {
    id: "general",
    label: "General",
    icon: SettingsIcon,
  },
  {
    id: "account",
    label: "Account",
    icon: UserCircleIcon,
  },
  {
    id: "sharing",
    label: "Cloud",
    icon: UploadIcon,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaintBrushIcon,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellIcon,
  },
  {
    id: "editor",
    label: "Editor",
    icon: CodeBlockIcon,
  },
  {
    id: "file-explorer",
    label: "Files",
    icon: SitemapIcon,
  },
  {
    id: "git",
    label: "Git",
    icon: GitBranchIcon,
  },
  {
    id: "terminal",
    label: "Terminal",
    icon: TerminalWindowIcon,
  },
  {
    id: "keyboard",
    label: "Keybindings",
    icon: KeyboardIcon,
  },
  {
    id: "ai",
    label: "AI",
    navigationLabel: "Overview",
    icon: SparkleIcon,
  },
  {
    id: "ai-models",
    label: "Models & keys",
    icon: KeyIcon,
  },
  {
    id: "ai-completion",
    label: "Tab completion",
    icon: TextIndentIcon,
  },
  {
    id: "ai-agents",
    label: "Agents",
    icon: ChatBubbleTextIcon,
  },
  {
    id: "ai-mcp",
    label: "MCP servers",
    icon: PlugsConnectedIcon,
  },
  {
    id: "collaboration",
    label: "Collaboration",
    icon: UsersIcon,
  },
  {
    id: "enterprise",
    label: "Enterprise",
    icon: ShieldCheckIcon,
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: GearIcon,
  },
];

/** The name each settings tab goes by in command titles and command palette results. */
export const settingsTabLabels: Record<SettingsTab, string> = {
  account: "Account",
  sharing: "Cloud",
  notifications: "Notifications",
  general: "General",
  editor: "Editor",
  git: "Git",
  appearance: "Appearance",
  ai: "AI",
  "ai-models": "AI Models & Keys",
  "ai-completion": "Tab Completion",
  "ai-agents": "AI Agents",
  "ai-mcp": "MCP Servers",
  keyboard: "Keybindings",
  language: "Editor",
  collaboration: "Collaboration",
  enterprise: "Enterprise",
  advanced: "Advanced",
  terminal: "Terminal",
  "file-explorer": "Files",
};
