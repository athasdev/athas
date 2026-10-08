import { useQuery } from "@tanstack/react-query";
import { pullRequestCommentsQuery, pullRequestDetailsQuery } from "../services/github-queries";
import { useGitHubRepoPath } from "./use-github-repo-path";

/**
 * What the cache already knows about a pull request, without fetching. Chrome outside the viewer
 * (tab badges, previews) reads this so each buffer shows its own pull request.
 */
export function useCachedPullRequest(bufferRepoPath: string | undefined, prNumber: number) {
  const repoPath = useGitHubRepoPath(bufferRepoPath);
  const details = useQuery({ ...pullRequestDetailsQuery(repoPath, prNumber), enabled: false }).data;
  const comments = useQuery({
    ...pullRequestCommentsQuery(repoPath, prNumber),
    enabled: false,
  }).data;
  return { details: details ?? null, comments: comments ?? null };
}
