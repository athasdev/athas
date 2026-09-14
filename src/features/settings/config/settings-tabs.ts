import {
  UploadIcon,
  BellIcon,
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
import type { SettingsSection } from "@/features/settings/types/settings.types";

export interface SettingsTabItem {
  id: SettingsSection;
  label: string;
  description: string;
  icon: Icon;
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
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
    id: "sharing",
    label: "Cloud",
    description: "Shared links, live updates, and private cloud sessions.",
    icon: UploadIcon,
  },
  {
    id: "appearance",
    description: "Themes, typography, and workspace appearance.",
    label: "Appearance",
    icon: PaintBrushIcon,
  },
  {
    id: "notifications",
    description: "Alerts for agents, terminal commands, and GitHub workflows.",
    label: "Notifications",
    icon: BellIcon,
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
