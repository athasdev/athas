import { areProjectTabPathsEqual } from "@/features/window/utils/project-tab-path";
import { useWorkspaceManagementStore } from "../stores/workspace-management.store";
import { loadTeamWorkspace } from "./team-workspace-service";
import type { TeamWorkspace } from "../types/team-workspace";

export async function loadWorkspaceTeamContext(projectRoot: string): Promise<TeamWorkspace | null> {
  const own = await loadTeamWorkspace(projectRoot);
  if (own) return own;
  const { bindings } = useWorkspaceManagementStore.getState();
  const matches: TeamWorkspace[] = [];
  for (const [root, repositories] of Object.entries(bindings)) {
    const ids = Object.entries(repositories)
      .filter((entry) => areProjectTabPathsEqual(entry[1], projectRoot))
      .map((entry) => entry[0]);
    if (!ids.length || areProjectTabPathsEqual(root, projectRoot)) continue;
    const team = await loadTeamWorkspace(root);
    if (team?.repositories?.some((repo) => ids.includes(repo.id))) matches.push(team);
  }
  if (matches.length > 1)
    throw new Error(
      "This project is linked to multiple team workspaces. Add an athas.workspace.json in this project to choose its AI instructions explicitly.",
    );
  return matches[0] ?? null;
}
