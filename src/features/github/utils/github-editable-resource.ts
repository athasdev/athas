import { invoke } from "@tauri-apps/api/core";
import type { IssueDetails, Label, PullRequestDetails } from "../types/github.types";

export type GitHubEditableResourceKind = "pull-request" | "issue";

export interface GitHubEditableResource {
  title: string;
  body: string;
  labels: Label[];
  selectedLabelNames: string[];
  assignees: string[];
}

export type GitHubResourceInvoker = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;

interface LoadGitHubEditableResourceOptions {
  repoPath: string;
  resourceNumber: number;
  kind: GitHubEditableResourceKind;
}

const invokeGitHubResource: GitHubResourceInvoker = (command, args) => invoke(command, args);

function mergeLabels(repositoryLabels: Label[], selectedLabels: Label[]): Label[] {
  const labelsByName = new Map(repositoryLabels.map((label) => [label.name, label]));
  for (const label of selectedLabels) labelsByName.set(label.name, label);
  return Array.from(labelsByName.values());
}

export async function loadGitHubEditableResource(
  { repoPath, resourceNumber, kind }: LoadGitHubEditableResourceOptions,
  invokeCommand: GitHubResourceInvoker = invokeGitHubResource,
): Promise<GitHubEditableResource> {
  const detailsPromise =
    kind === "issue"
      ? invokeCommand<IssueDetails>("github_get_issue_details", {
          repoPath,
          issueNumber: resourceNumber,
        })
      : invokeCommand<PullRequestDetails>("github_get_pr_details", {
          repoPath,
          prNumber: resourceNumber,
        });
  const labelsPromise = invokeCommand<Label[]>("github_list_labels", { repoPath }).catch(() => []);
  const [details, repositoryLabels] = await Promise.all([detailsPromise, labelsPromise]);

  return {
    title: details.title,
    body: details.body,
    labels: mergeLabels(repositoryLabels, details.labels),
    selectedLabelNames: details.labels.map((label) => label.name),
    assignees: details.assignees.map((assignee) => assignee.login),
  };
}
