import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/utils/query-client";
import { useEffect, useMemo } from "react";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { useGitStore } from "@/features/git/stores/git.store";
import { areProjectTabPathsEqual } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import {
  cloudAgentBranchesQuery,
  cloudAgentReposQuery,
  projectGitHubRepoQuery,
} from "../services/cloud-agents-queries";
import { orderCloudRepos, pickDefaultCloudBranch } from "../services/cloud-environment";
import type { AgentEnvironment } from "./use-agent-environment";

/**
 * The repositories and branches a cloud run can start from, and the defaults: the project's own
 * GitHub repository, and the branch checked out here when GitHub has it, else the default branch.
 * Fills the defaults into `environment` while it has none.
 */
export function useCloudTargets(
  environment: AgentEnvironment,
  workspacePath: string | null | undefined,
) {
  const { hasCloudAgents } = useProFeature();
  const active = hasCloudAgents && environment.kind === "cloud";
  const projectRepoQuery = useQuery(
    {
      ...projectGitHubRepoQuery(workspacePath),
      enabled: active && projectGitHubRepoQuery(workspacePath).enabled,
    },
    queryClient,
  );
  const projectRepo = projectRepoQuery.data ?? null;
  const reposQuery = useQuery(cloudAgentReposQuery(active), queryClient);
  const repo = environment.repo ?? projectRepo;
  const branchesQuery = useQuery(
    {
      ...cloudAgentBranchesQuery(repo),
      enabled: active && Boolean(repo),
    },
    queryClient,
  );
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const checkedOutBranch = useGitStore((state) => state.gitStatus?.branch ?? null);
  const isProjectRepo = Boolean(
    repo && projectRepo && repo.toLowerCase() === projectRepo.toLowerCase(),
  );
  const localBranch =
    isProjectRepo &&
    workspacePath &&
    rootFolderPath &&
    areProjectTabPathsEqual(workspacePath, rootFolderPath)
      ? checkedOutBranch
      : null;
  const repoDefaultBranch =
    reposQuery.data?.find((candidate) => candidate.fullName.toLowerCase() === repo?.toLowerCase())
      ?.defaultBranch ?? null;
  const remote = branchesQuery.data
    ? {
        ...branchesQuery.data,
        defaultBranch: branchesQuery.data.defaultBranch ?? repoDefaultBranch,
      }
    : branchesQuery.isError && repoDefaultBranch
      ? { defaultBranch: repoDefaultBranch, branches: [] }
      : null;
  const branchesSettled = !branchesQuery.isLoading;
  const defaultBranch = branchesSettled ? pickDefaultCloudBranch({ localBranch, remote }) : null;

  const { setRepo, setBranch } = environment;
  useEffect(() => {
    if (active && !environment.repo && projectRepo) setRepo(projectRepo);
  }, [active, environment.repo, projectRepo, setRepo]);
  useEffect(() => {
    if (active && environment.repo && !environment.branch && defaultBranch)
      setBranch(defaultBranch);
  }, [active, defaultBranch, environment.branch, environment.repo, setBranch]);

  const repos = useMemo(
    () => orderCloudRepos(reposQuery.data ?? [], projectRepo),
    [projectRepo, reposQuery.data],
  );
  const branches = useMemo(() => {
    const names = new Set(branchesQuery.data?.branches ?? []);
    const preferred = [remote?.defaultBranch, localBranch].filter((name): name is string =>
      Boolean(name && (names.has(name) || !branchesQuery.data)),
    );
    return [...new Set([...preferred, ...names])];
  }, [branchesQuery.data, localBranch, remote?.defaultBranch]);

  return {
    projectRepo,
    repos,
    reposLoading: reposQuery.isLoading,
    reposError: reposQuery.error,
    branches,
    branchesLoading: branchesQuery.isLoading,
    branchesError: branchesQuery.error,
    defaultBranch: remote?.defaultBranch ?? null,
    projectRepoResolved: !projectRepoQuery.isLoading,
  };
}

export type CloudTargets = ReturnType<typeof useCloudTargets>;
