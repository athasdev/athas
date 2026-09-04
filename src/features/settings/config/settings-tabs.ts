import {
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
  { id: "general", label: "General", icon: GearSix },
  { id: "account", label: "Account", icon: UserCircle },
  { id: "appearance", label: "Appearance", icon: PaintBrush },
  { id: "editor", label: "Editor", icon: CodeBlock },
  { id: "file-explorer", label: "Files", icon: TreeStructure },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "terminal", label: "Terminal", icon: TerminalWindow },
  { id: "keyboard", label: "Keybindings", icon: Keyboard },
  { id: "ai", label: "Agent", icon: Sparkle },
  { id: "collaboration", label: "Collaboration", icon: UsersThree },
  { id: "enterprise", label: "Enterprise", icon: ShieldCheck },
  { id: "advanced", label: "Advanced", icon: Gear },
];

export const SETTINGS_TAB_GROUPS: SettingsTabGroup[] = [
  {
    id: "application",
    label: "Application",
    tabs: ["general", "account", "appearance"],
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
