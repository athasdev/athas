import {
  Archive,
  Browser,
  GitBranch,
  GitCommit,
  GitPullRequest,
  ListChecks,
  Pulse,
  TerminalWindow,
  TreeStructure,
  WarningCircle,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { SidebarBuilderWidgetType } from "../stores/sidebar-builder-store";

export interface SidebarBuilderWidgetDefinition {
  type: SidebarBuilderWidgetType;
  label: string;
  description: string;
  icon: ReactNode;
}

export const SIDEBAR_BUILDER_WIDGET_DEFINITIONS: SidebarBuilderWidgetDefinition[] = [
  {
    type: "github-prs",
    label: "Pull Requests",
    description: "GitHub pull requests from the active repository",
    icon: <GitPullRequest weight="duotone" />,
  },
  {
    type: "github-issues",
    label: "Issues",
    description: "Open GitHub issues",
    icon: <WarningCircle weight="duotone" />,
  },
  {
    type: "github-actions",
    label: "Actions",
    description: "Recent GitHub workflow runs",
    icon: <Pulse weight="duotone" />,
  },
  {
    type: "git-history",
    label: "History",
    description: "Recent commits from Git",
    icon: <GitCommit weight="duotone" />,
  },
  {
    type: "git-changes",
    label: "Uncommitted Changes",
    description: "Changed files in the working tree",
    icon: <ListChecks weight="duotone" />,
  },
  {
    type: "git-stashes",
    label: "Stashes",
    description: "Saved Git stashes",
    icon: <Archive weight="duotone" />,
  },
  {
    type: "git-worktrees",
    label: "Worktrees",
    description: "Git worktree shortcuts",
    icon: <TreeStructure weight="duotone" />,
  },
  {
    type: "git-branches",
    label: "Branches",
    description: "Local and remote branch shortcuts",
    icon: <GitBranch weight="duotone" />,
  },
  {
    type: "terminals",
    label: "Terminals",
    description: "Open terminal tabs and a quick new terminal action",
    icon: <TerminalWindow weight="duotone" />,
  },
  {
    type: "browser-tabs",
    label: "Browser Tabs",
    description: "Open web viewer tabs and a quick new browser tab action",
    icon: <Browser weight="duotone" />,
  },
];

export const SIDEBAR_BUILDER_WIDGET_DEFINITION_BY_TYPE = new Map(
  SIDEBAR_BUILDER_WIDGET_DEFINITIONS.map((definition) => [definition.type, definition]),
);
