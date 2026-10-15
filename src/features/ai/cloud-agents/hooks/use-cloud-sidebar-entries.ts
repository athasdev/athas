import { useQueries } from "@tanstack/react-query";
import { queryClient } from "@/utils/query-client";
import { useMemo } from "react";
import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { useProFeature } from "@/features/auth/hooks/use-pro-feature";
import { projectGitHubRepoQuery } from "../services/cloud-agents-queries";
import { groupCloudSidebarEntries } from "../services/cloud-run-sidebar";
import { useCloudRuns } from "./use-cloud-runs";

/** The sidebar's cloud runs without a session, by project, and the cloud sessions of no project. */
export function useCloudSidebarEntries<
  P extends { id: string; path: string },
  T extends ChatSession,
>(chats: readonly T[], projects: readonly P[]) {
  const { hasCloudAgents } = useProFeature();
  const { runs } = useCloudRuns();
  const repoResults = useQueries(
    {
      queries: projects.map((project) => ({
        ...projectGitHubRepoQuery(project.path),
        enabled: hasCloudAgents && projectGitHubRepoQuery(project.path).enabled,
      })),
    },
    queryClient,
  );
  const repoKey = repoResults.map((result) => result.data ?? "").join("\n");
  const projectRepos = useMemo(
    () =>
      Object.fromEntries(
        projects.map((project, index) => [project.path, repoKey.split("\n")[index] || null]),
      ),
    [projects, repoKey],
  );
  return useMemo(
    () =>
      groupCloudSidebarEntries({
        runs: hasCloudAgents ? runs : [],
        chats,
        projects,
        projectRepos,
      }),
    [chats, hasCloudAgents, projectRepos, projects, runs],
  );
}
