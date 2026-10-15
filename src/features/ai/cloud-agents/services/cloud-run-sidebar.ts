import type { ChatSession } from "@/features/ai/types/ai-chat.types";
import { areProjectTabPathsEqual } from "@/features/workspace/services/project-tab-path";
import { type CloudAgentRun, isActiveCloudAgentRun } from "./cloud-agents-api";

/** Finished runs older than this stay on the server but leave the sidebar. */
export const CLOUD_RUN_SIDEBAR_DAYS = 14;

interface SidebarProject {
  id: string;
  path: string;
}

export interface CloudSidebarGroups<P extends SidebarProject, T extends ChatSession> {
  /** Runs with no session here yet, by the open project whose repository they ran on. */
  runsByProject: Record<string, CloudAgentRun[]>;
  /** Runs on repositories no open project pushes to. */
  otherRuns: CloudAgentRun[];
  /** Cloud sessions that belong to no open project, such as runs opened from the Cloud list. */
  otherChats: T[];
  projects: readonly P[];
}

/**
 * Where the sidebar lists cloud work that has no place among a project's sessions: runs started
 * elsewhere (another device, or before runs became sessions) go under the project whose GitHub
 * repository they ran on, and the rest, with cloud sessions of repositories not open here, under
 * Cloud. A run that already has a session is listed as that session instead.
 */
export function groupCloudSidebarEntries<P extends SidebarProject, T extends ChatSession>({
  runs,
  chats,
  projects,
  projectRepos,
  now = Date.now(),
}: {
  runs: readonly CloudAgentRun[];
  chats: readonly T[];
  projects: readonly P[];
  /** Each open project's GitHub repository as `owner/name`, by project path. */
  projectRepos: Readonly<Record<string, string | null | undefined>>;
  now?: number;
}): CloudSidebarGroups<P, T> {
  const adopted = new Set(
    chats.flatMap((chat) => chat.sessionSettings?.cloud?.runs.map((run) => run.runId) ?? []),
  );
  const cutoff = now - CLOUD_RUN_SIDEBAR_DAYS * 86_400_000;
  const repoProject = (repo: string) =>
    projects.find((project) => projectRepos[project.path]?.toLowerCase() === repo.toLowerCase());

  const runsByProject: Record<string, CloudAgentRun[]> = {};
  const otherRuns: CloudAgentRun[] = [];
  for (const run of runs) {
    if (adopted.has(run.id)) continue;
    if (!isActiveCloudAgentRun(run) && (Date.parse(run.createdAt) || 0) < cutoff) continue;
    const project = repoProject(run.repo);
    if (project) (runsByProject[project.id] ??= []).push(run);
    else otherRuns.push(run);
  }

  const otherChats = chats.filter((chat) => {
    const path = chat.workspacePath;
    return (
      Boolean(chat.sessionSettings?.cloud && path) &&
      !chat.archivedAt &&
      !projects.some((project) => areProjectTabPathsEqual(project.path, path!))
    );
  });

  return { runsByProject, otherRuns, otherChats, projects };
}
