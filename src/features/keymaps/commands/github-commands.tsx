import type { ReactNode } from "react";
import {
  ArrowClockwiseIcon,
  BoltIcon,
  ChatBubbleTextIcon,
  GitPullRequestIcon,
  LinkIcon,
  RocketIcon,
  TagIcon,
  WarningCircleIcon,
} from "@/ui/icons";
import type { Command } from "../types/keymaps.types";
import type { GitHubSidebarSection } from "./github-command-actions";

const githubActions = () => import("./github-command-actions");

function githubSectionCommand(
  id: string,
  title: string,
  description: string,
  icon: ReactNode,
  section: GitHubSidebarSection,
  keybindingCommandId?: string,
): Command {
  return {
    id,
    title,
    category: "GitHub",
    description,
    icon,
    palette: { closePalette: "settled", keybindingCommandId },
    execute: async () => (await githubActions()).openGitHubSection(section),
  };
}

function githubFormCommand(
  id: string,
  title: string,
  description: string,
  icon: ReactNode,
  formKind: "pull-request" | "issue" | "action",
): Command {
  return {
    id,
    title,
    category: "GitHub",
    description,
    icon,
    palette: true,
    execute: async () => (await githubActions()).openGitHubForm(formKind),
  };
}

export const githubCommands: Command[] = [
  githubSectionCommand(
    "github.showReleases",
    "GitHub: Show Releases",
    "Browse release notes, drafts, and assets",
    <TagIcon />,
    "releases",
  ),
  githubSectionCommand(
    "github.showDeployments",
    "GitHub: Show Deployments",
    "Inspect environments and deployment status history",
    <RocketIcon />,
    "deployments",
  ),
  {
    id: "github.newRelease",
    title: "GitHub: New Release",
    category: "GitHub",
    description: "Draft a release in the active repository",
    icon: <TagIcon />,
    palette: true,
    execute: async () => (await githubActions()).openGitHubReleaseDraft(),
  },
  githubFormCommand(
    "github.newIssue",
    "GitHub: New Issue",
    "Create an issue in the active repository",
    <ChatBubbleTextIcon />,
    "issue",
  ),
  githubFormCommand(
    "github.newPullRequest",
    "GitHub: New Pull Request",
    "Create a pull request in the active repository",
    <GitPullRequestIcon />,
    "pull-request",
  ),
  githubFormCommand(
    "github.runWorkflow",
    "GitHub: Run Workflow",
    "Dispatch a workflow in the active repository",
    <BoltIcon />,
    "action",
  ),
  githubSectionCommand(
    "github.showPullRequests",
    "GitHub: Show Pull Requests",
    "Open GitHub pull requests",
    <GitPullRequestIcon />,
    "pull-requests",
    "workbench.showGitHub",
  ),
  githubSectionCommand(
    "github.showIssues",
    "GitHub: Show Issues",
    "Open GitHub issues",
    <WarningCircleIcon />,
    "issues",
  ),
  githubSectionCommand(
    "github.showActions",
    "GitHub: Show Actions",
    "Open GitHub workflow runs",
    <BoltIcon />,
    "actions",
  ),
  {
    id: "github.refresh",
    title: "GitHub: Refresh Current View",
    category: "GitHub",
    description: "Refresh the active GitHub sidebar section",
    icon: <ArrowClockwiseIcon />,
    palette: true,
    execute: async () => (await githubActions()).refreshGitHubView(),
  },
  {
    id: "github.checkAuthentication",
    title: "GitHub: Check Authentication",
    category: "GitHub",
    description: "Refresh GitHub account authentication",
    icon: <ArrowClockwiseIcon />,
    palette: true,
    execute: async () => (await githubActions()).checkGitHubAuthentication(),
  },
  {
    id: "github.connectAccount",
    title: "GitHub: Connect Account",
    category: "GitHub",
    description: "Open GitHub integration settings",
    icon: <LinkIcon />,
    palette: true,
    execute: async () => (await githubActions()).connectGitHubAccount(),
  },
];
