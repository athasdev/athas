import { toast } from "sonner";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";
import {
  buildGitHubWorkPrompt,
  type PullRequestBranchState,
} from "@/features/ai/lib/github-work-prompt";
import { launchAgentInProject } from "@/features/ai/services/agent-project-navigation";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { checkoutPullRequest } from "@/features/github/services/github-pull-request-actions";
import {
  issueDetailsQuery,
  pullRequestDetailsQuery,
} from "@/features/github/services/github-queries";
import type { GitHubWorkItem } from "@/features/github/utils/github-work-suggestions";
import { queryClient } from "@/utils/query-client";

async function readBody(repoPath: string, item: GitHubWorkItem): Promise<string | null> {
  try {
    const details =
      item.kind === "pull-request"
        ? await queryClient.fetchQuery(pullRequestDetailsQuery(repoPath, item.number))
        : await queryClient.fetchQuery(issueDetailsQuery(repoPath, item.number));
    return details.body;
  } catch {
    return null;
  }
}

/**
 * Switches the repository to the pull request's branch when that cannot lose work: never with
 * uncommitted changes to tracked files, which the agent is told about instead.
 */
async function preparePullRequestBranch(
  repoPath: string,
  item: Extract<GitHubWorkItem, { kind: "pull-request" }>,
): Promise<PullRequestBranchState> {
  try {
    const status = await getGitStatus(repoPath);
    if (!status) return "failed";
    if (status.branch === item.headRef) return "already-on-branch";
    if (status.files.some((file) => file.status !== "untracked")) return "dirty";
    await checkoutPullRequest(repoPath, item.number);
    return "checked-out";
  } catch (error) {
    console.error(`Failed to check out pull request #${item.number}:`, error);
    toast.error(`Could not check out pull request #${item.number}; the agent will do it.`);
    return "failed";
  }
}

/**
 * Starts an agent session on a GitHub pull request or issue in `projectId` (the active project
 * when null): its title, link and description go in as the first message, and a pull request's
 * branch is checked out first when that is safe.
 */
export async function startGitHubWork(
  projectId: string | null,
  repoPath: string,
  item: GitHubWorkItem,
): Promise<string | null> {
  const { selectedAgentId, hasApiKey } = useAIChatStore.getState();
  const access = getAgentMessageAccess(selectedAgentId, hasApiKey);
  if (!access.accepted) {
    toast.error(access.error ?? "This agent is not ready.");
    return null;
  }

  const [body, branch] = await Promise.all([
    readBody(repoPath, item),
    item.kind === "pull-request" ? preparePullRequestBranch(repoPath, item) : undefined,
  ]);
  return launchAgentInProject(projectId, {
    agentId: selectedAgentId,
    prompt: buildGitHubWorkPrompt(item, { body, branch }),
    selectedBufferIds: [],
    selectedFilesPaths: [],
    editorSelections: [],
  });
}
