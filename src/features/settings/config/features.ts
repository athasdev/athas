import {
  Brain,
  Bug,
  GitBranch,
  Github,
  MessageSquare,
  Navigation,
  Search,
  Server,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { CoreFeature } from "../types/feature";

export const createCoreFeaturesList = (coreFeatures: any): CoreFeature[] => [
  {
    id: "git",
    name: "Git Integration",
    description: "Source control management with Git repositories",
    icon: GitBranch,
    enabled: coreFeatures.git,
  },
  {
    id: "github",
    name: "GitHub Integration",
    description: "Pull requests, issues, and GitHub features",
    icon: Github,
    enabled: coreFeatures.github,
  },
  {
    id: "remote",
    name: "Remote Development",
    description: "Connect to remote servers via SSH",
    icon: Server,
    enabled: coreFeatures.remote,
  },
  {
    id: "terminal",
    name: "Integrated Terminal",
    description: "Built-in terminal for command line operations",
    icon: TerminalIcon,
    enabled: coreFeatures.terminal,
  },
  {
    id: "search",
    name: "Global Search",
    description: "Search across files and folders in workspace",
    icon: Search,
    enabled: coreFeatures.search,
  },
  {
    id: "diagnostics",
    name: "Diagnostics & Problems",
    description: "Code diagnostics and error reporting",
    icon: Bug,
    enabled: coreFeatures.diagnostics,
  },
  {
    id: "aiChat",
    name: "AI Assistant",
    description: "AI-powered code assistance and chat",
    icon: MessageSquare,
    enabled: coreFeatures.aiChat,
  },
  {
    id: "breadcrumbs",
    name: "Breadcrumbs",
    description: "File path navigation breadcrumbs in editor",
    icon: Navigation,
    enabled: coreFeatures.breadcrumbs,
  },
  {
    id: "persistentCommands",
    name: "Persistent Commands",
    description: "The last used commands appear at the top of the command palette",
    icon: Brain,
    enabled: coreFeatures.persistentCommands,
  },
];
