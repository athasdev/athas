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
import type { SettingsSection } from "@/features/settings/types/settings.types";

export interface SettingsTabItem {
  id: SettingsSection;
  label: string;
  /** A shorter name for the settings sidebar, where the page's group already names it. */
  navigationLabel?: string;
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
    description: "Your Athas plan and the model AI features use by default.",
    label: "AI",
    navigationLabel: "Overview",
    icon: SparkleIcon,
  },
  {
    id: "ai-models",
    description: "Your own API keys, Ollama, and OpenAI-compatible servers.",
    label: "Models & keys",
    icon: KeyIcon,
  },
  {
    id: "ai-completion",
    description: "Code suggestions as you type, accepted with Tab.",
    label: "Tab completion",
    icon: TextIndentIcon,
  },
  {
    id: "ai-agents",
    description: "Coding agents, what they may run on their own, and chat history.",
    label: "Agents",
    icon: ChatBubbleTextIcon,
  },
  {
    id: "ai-mcp",
    description: "Tools and context that MCP servers give agents.",
    label: "MCP servers",
    icon: PlugsConnectedIcon,
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
