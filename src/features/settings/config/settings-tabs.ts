import {
  UploadIcon,
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
import type { SettingsTab } from "@/features/window/stores/ui-state.store";

export interface SettingsTabItem {
  id: SettingsTab;
  label: string;
  description: string;
  icon: ComponentType<{
    size?: string | number;
    className?: string;
    weight?: "regular" | "duotone";
  }>;
}

export interface SettingsTabGroup {
  id: string;
  label: string;
  tabs: SettingsTab[];
}

export const SETTINGS_TAB_ITEMS: SettingsTabItem[] = [
  {
    id: "sharing",
    label: "Sharing & cloud",
    description: "Shared links, live updates, and private cloud sessions.",
    icon: UploadIcon,
  },
  {
    id: "general",
    description: "Updates, setup, and application preferences.",
    label: "General",
    icon: GearSix,
  },
  {
    id: "account",
    description: "Your profile, subscription, and connected account.",
    label: "Account",
    icon: UserCircle,
  },
  {
    id: "appearance",
    description: "Themes, typography, and workspace appearance.",
    label: "Appearance",
    icon: PaintBrush,
  },
  {
    id: "editor",
    description: "Editing behavior, formatting, and code display.",
    label: "Editor",
    icon: CodeBlock,
  },
  {
    id: "file-explorer",
    description: "File visibility and explorer behavior.",
    label: "Files",
    icon: TreeStructure,
  },
  { id: "git", description: "Version control and change tracking.", label: "Git", icon: GitBranch },
  {
    id: "terminal",
    description: "Shell, terminal appearance, and behavior.",
    label: "Terminal",
    icon: TerminalWindow,
  },
  {
    id: "keyboard",
    description: "Shortcuts for the way you work.",
    label: "Keybindings",
    icon: Keyboard,
  },
  { id: "ai", description: "Agent models, tools, and preferences.", label: "Agent", icon: Sparkle },
  {
    id: "collaboration",
    description: "Shared workspaces and collaboration preferences.",
    label: "Collaboration",
    icon: UsersThree,
  },
  {
    id: "enterprise",
    description: "Organization policies and access.",
    label: "Enterprise",
    icon: ShieldCheck,
  },
  {
    id: "advanced",
    description: "Diagnostics and advanced application options.",
    label: "Advanced",
    icon: Gear,
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
