import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryClient } from "@/utils/query-client";
import {
  pullRequestDetailsQuery,
  pullRequestListQuery,
} from "@/features/github/services/github-queries";
import { useGitHubStore } from "@/features/github/stores/github.store";
import { isRemotePath } from "@/features/remote/services/remote-path";
import { isWslPath } from "@/features/wsl/services/wsl-path";
import type { CloudAgentRun } from "@/features/ai/cloud-agents/services/cloud-agents-api";
import {
  getPullRequestNumber,
  readPullRequestState,
  type SessionPullRequestState,
} from "@/features/ai/services/session-status";
import { useSessionPullRequestsStore } from "@/features/ai/stores/session-pull-requests.store";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";

/** Branches that are a repository's trunk rather than a session's own work. */
const TRUNK_BRANCHES = new Set(["main", "master", "trunk", "develop"]);

function isLocalRepository(path: string | null | undefined): path is string {
  return Boolean(path) && !isRemotePath(path) && !isWslPath(path) && !path!.includes("://");
}

/**
 * Where the pull request of a session stands: the one its cloud run opened, or the one open for
 * the branch it works on. Reads GitHub's open pull request list the GitHub pane keeps; a pull
 * request that leaves that list is looked up once more, to tell a merge from a close.
 */
export function useSessionPullRequest(
  chat: Pick<ChatSession, "id" | "workspacePath" | "branch">,
  cloudRun: Pick<CloudAgentRun, "prUrl"> | null,
): SessionPullRequestState | null {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const repoPath = isLocalRepository(chat.workspacePath) ? chat.workspacePath : null;
  const branch = chat.branch && !TRUNK_BRANCHES.has(chat.branch) ? chat.branch : null;
  const cloudNumber = getPullRequestNumber(cloudRun?.prUrl);
  const remembered = useSessionPullRequestsStore((state) => state.byChat[chat.id] ?? null);
  const { remember } = useSessionPullRequestsStore.use.actions();
  const enabled =
    isAuthenticated && Boolean(repoPath) && Boolean(branch || cloudNumber || remembered);

  const { data: openPullRequests } = useQuery(
    { ...pullRequestListQuery(enabled ? repoPath : null, "all"), enabled },
    queryClient,
  );
  const open = openPullRequests?.find((pullRequest) =>
    cloudNumber ? pullRequest.number === cloudNumber : branch && pullRequest.headRef === branch,
  );

  useEffect(() => {
    if (open && repoPath && !cloudNumber) remember(chat.id, repoPath, open.number);
  }, [chat.id, cloudNumber, open, remember, repoPath]);

  const number = cloudNumber ?? remembered?.number ?? null;
  const lookUp = enabled && Boolean(openPullRequests) && !open && number !== null;
  const { data: details } = useQuery(
    { ...pullRequestDetailsQuery(lookUp ? repoPath : null, number ?? 0), enabled: lookUp },
    queryClient,
  );

  if (open) return "open";
  return lookUp && details ? readPullRequestState(details) : null;
}
