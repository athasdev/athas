import {
  Bug,
  GitBranch,
  MessageSquare,
  Search,
  Server,
  Terminal as TerminalIcon,
} from "lucide-react";
import type { CoreFeature } from "../types/core-features";

export const createCoreFeaturesList = (coreFeatures: any): CoreFeature[] => [
  {
    id: "git",
    name: "Git Integration",
    description: "Source control management with Git repositories",
    icon: GitBranch,
    enabled: coreFeatures.git,
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
];

export const handleCoreFeatureToggle = (
  featureId: string,
  enabled: boolean,
  currentFeatures: any,
  setFeatures: (features: any) => void,
) => {
  const newFeatures = { ...currentFeatures, [featureId]: enabled };
  setFeatures(newFeatures);
  try {
    localStorage.setItem("athas-code-core-features", JSON.stringify(newFeatures));
  } catch (error) {
    console.error("Error saving core features:", error);
  }
};
