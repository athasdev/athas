import {
  UploadIcon,
  CodeBlockIcon,
  GearIcon,
  GitBranchIcon,
  type Icon,
  KeyboardIcon,
  PaintBrushIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SitemapIcon,
  SparkleIcon,
  TerminalWindowIcon,
  UserCircleIcon,
  UsersIcon,
} from "@/ui/icons";
import type { SettingsTab } from "@/features/window/stores/ui-state.store";

export interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  description: string;
  icon: Icon;
}

export interface SettingsTabGroup {
  id: string;
  label: string;
  tabs: SettingsTab[];
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  {
    id: "sharing",
    label: "Sharing & Cloud",
    description: "Shared links, live updates, and private cloud sessions.",
    icon: UploadIcon,
  },
  {
    id: "general",
    description: "Updates, setup, and application preferences.",
    label: "General",
    icon: SettingsIcon,
  },
  {
    id: "account",
    description: "Your profile, subscription, and connected account.",
    label: "Account",
    icon: UserCircleIcon,
  },
  {
    id: "appearance",
    description: "Themes, typography, and workspace appearance.",
    label: "Appearance",
    icon: PaintBrushIcon,
  },
  {
    id: "editor",
    description: "Editing behavior, formatting, and code display.",
    label: "Editor",
    icon: CodeBlockIcon,
  },
  {
    id: "file-explorer",
    description: "File visibility and explorer behavior.",
    label: "Files",
    icon: SitemapIcon,
  },
  {
    id: "git",
    description: "Version control and change tracking.",
    label: "Git",
    icon: GitBranchIcon,
  },
  {
    id: "terminal",
    description: "Shell, terminal appearance, and behavior.",
    label: "Terminal",
    icon: TerminalWindowIcon,
  },
  {
    id: "keyboard",
    description: "Shortcuts for the way you work.",
    label: "Keybindings",
    icon: KeyboardIcon,
  },
  {
    id: "ai",
    description: "Agent models, tools, and preferences.",
    label: "Agent",
    icon: SparkleIcon,
  },
  {
    id: "collaboration",
    description: "Shared workspaces and collaboration preferences.",
    label: "Collaboration",
    icon: UsersIcon,
  },
  {
    id: "enterprise",
    description: "Organization policies and access.",
    label: "Enterprise",
    icon: ShieldCheckIcon,
  },
  {
    id: "advanced",
    description: "Diagnostics and advanced application options.",
    label: "Advanced",
    icon: GearIcon,
  },
];

export const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = [
  {
    id: "application",
    label: "Application",
    tabs: ["general", "account", "sharing", "appearance"],
  },
  {
    id: "workspace",
    label: "Workspace",
    tabs: ["editor", "file-explorer", "git", "terminal", "keyboard"],
  },
  {
    id: "features",
    label: "Features",
    tabs: ["ai", "collaboration", "enterprise", "advanced"],
  },
];
