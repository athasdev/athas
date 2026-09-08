import { invoke } from "@tauri-apps/api/core";
import { writeFile } from "@/features/file-system/controllers/platform";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { joinPath } from "@/utils/path-helpers";
import type { TeamWorkspace } from "../types/team-workspace";
import { parseTeamWorkspace, TEAM_WORKSPACE_FILE } from "../utils/team-workspace-config";

export const TEAM_WORKSPACE_CHANGED_EVENT = "team-workspace-changed";

export async function readTeamWorkspaceContent(workspacePath: string): Promise<string | null> {
  const provider = getWorkspaceResourceProvider(workspacePath);
  const entries = await provider.readDirectory(workspacePath, workspacePath);
  if (!entries.some((entry) => entry.name === TEAM_WORKSPACE_FILE)) return null;
  return provider.readText(joinPath(workspacePath, TEAM_WORKSPACE_FILE));
}

export async function loadTeamWorkspace(workspacePath: string): Promise<TeamWorkspace | null> {
  const content = await readTeamWorkspaceContent(workspacePath);
  return content === null ? null : parseTeamWorkspace(content);
}

export async function saveTeamWorkspace(
  workspacePath: string,
  config: TeamWorkspace,
  original: string | null,
): Promise<void> {
  const validated = parseTeamWorkspace(JSON.stringify(config));
  const current = await readTeamWorkspaceContent(workspacePath);
  if (current !== original) {
    throw new Error("The team workspace changed on disk. Reload the workspace before saving.");
  }
  const path = joinPath(workspacePath, TEAM_WORKSPACE_FILE);
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  const remote = parseRemotePath(path);
  if (remote) {
    await invoke("ssh_write_file", {
      connectionId: remote.connectionId,
      filePath: remote.remotePath,
      content,
    });
  } else {
    await writeFile(path, content);
  }
  window.dispatchEvent(new CustomEvent(TEAM_WORKSPACE_CHANGED_EVENT, { detail: workspacePath }));
}
