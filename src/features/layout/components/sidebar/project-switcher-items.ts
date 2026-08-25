import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";

export function getProjectRemoteConnectionId(projectPath?: string) {
  return projectPath ? parseRemotePath(projectPath)?.connectionId : undefined;
}

export function getClosedRemoteConnections(
  projects: ProjectTab[],
  connections: RemoteConnection[],
) {
  const openConnectionIds = new Set(
    projects
      .map((project) => getProjectRemoteConnectionId(project.path))
      .filter((connectionId): connectionId is string => Boolean(connectionId)),
  );

  return connections.filter((connection) => !openConnectionIds.has(connection.id));
}
