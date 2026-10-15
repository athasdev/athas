import { queryOptions } from "@tanstack/react-query";
import { resolveProjectGitHubRepository } from "@/features/views/services/view-github";
import { isRemoteProjectPath } from "@/features/workspace/services/project-tab-path";
import {
  isActiveCloudAgentRun,
  listCloudAgentBranches,
  listCloudAgentRepos,
  listCloudAgentRuns,
} from "./cloud-agents-api";

const RUN_POLL_MS = 5000;

export const cloudAgentKeys = {
  all: ["cloud-agents"] as const,
  runs: () => [...cloudAgentKeys.all, "runs"] as const,
  repos: () => [...cloudAgentKeys.all, "repos"] as const,
  branches: (repo: string) => [...cloudAgentKeys.all, "branches", repo.toLowerCase()] as const,
  projectRepo: (path: string) => [...cloudAgentKeys.all, "project-repo", path] as const,
};

/** Every run of the user, followed every few seconds while one is still working. */
export function cloudAgentRunsQuery(enabled: boolean) {
  return queryOptions({
    queryKey: cloudAgentKeys.runs(),
    queryFn: listCloudAgentRuns,
    enabled,
    staleTime: RUN_POLL_MS,
    refetchInterval: (query) =>
      query.state.data?.some(isActiveCloudAgentRun) ? RUN_POLL_MS : false,
  });
}

export function cloudAgentReposQuery(enabled: boolean) {
  return queryOptions({
    queryKey: cloudAgentKeys.repos(),
    queryFn: listCloudAgentRepos,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function cloudAgentBranchesQuery(repo: string | null) {
  return queryOptions({
    queryKey: cloudAgentKeys.branches(repo ?? ""),
    queryFn: () => listCloudAgentBranches(repo!),
    enabled: Boolean(repo),
    staleTime: 60_000,
    retry: false,
  });
}

/** The GitHub repository a project folder pushes to, as `owner/name`. */
export function projectGitHubRepoQuery(path: string | null | undefined) {
  return queryOptions({
    queryKey: cloudAgentKeys.projectRepo(path ?? ""),
    queryFn: async () => {
      const repository = await resolveProjectGitHubRepository(path!);
      return repository ? `${repository.owner}/${repository.repo}` : null;
    },
    enabled: Boolean(path) && !isRemoteProjectPath(path!),
    staleTime: 5 * 60_000,
    retry: false,
  });
}
