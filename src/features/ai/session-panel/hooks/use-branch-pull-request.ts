import { useQuery } from "@tanstack/react-query";
import { pullRequestListQuery } from "@/features/github/services/github-queries";
import { useGitHubStore } from "@/features/github/stores/github.store";
import type { PullRequest } from "@/features/github/types/github.types";
import { isRemotePath } from "@/features/remote/services/remote-path";
import { isWslPath } from "@/features/wsl/services/wsl-path";

/** The pull request whose head is `branch`, preferring an open one over a closed or merged one. */
export function findBranchPullRequest(
  pullRequests: readonly PullRequest[],
  branch: string | null,
): PullRequest | null {
  if (!branch) return null;
  const matches = pullRequests.filter((pullRequest) => pullRequest.headRef === branch);
  return (
    matches.find((pullRequest) => pullRequest.state.toUpperCase() === "OPEN") ?? matches[0] ?? null
  );
}

/**
 * The pull request open for the session's branch, read from the same GitHub list the pull
 * requests view keeps. Asks GitHub only once the user signed in, and only for a local repository.
 */
export function useBranchPullRequest(repoPath: string | null, branch: string | null) {
  const isAuthenticated = useGitHubStore.use.isAuthenticated();
  const isLocal = Boolean(repoPath) && !isRemotePath(repoPath) && !isWslPath(repoPath);
  const enabled = isAuthenticated && isLocal && Boolean(branch);
  const { data } = useQuery({
    ...pullRequestListQuery(enabled ? repoPath : null, "all"),
    enabled,
  });
  return enabled ? findBranchPullRequest(data ?? [], branch) : null;
}
