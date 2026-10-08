import { parseRemotePath } from "@/features/remote/utils/remote-path";
import type { ProjectTab } from "../stores/workspace-tabs.store";

export function renameRemoteProjectTabs(
  projectTabs: ProjectTab[],
  connectionId: string,
  connectionName: string,
) {
  return projectTabs.map((tab) => {
    const remoteInfo = parseRemotePath(tab.path);
    if (remoteInfo?.connectionId !== connectionId || tab.name === connectionName) {
      return tab;
    }

    return {
      ...tab,
      name: connectionName,
    };
  });
}
