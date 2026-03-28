import { create } from "zustand";
import { combine } from "zustand/middleware";
import { connectionStore } from "@/features/remote/services/remote-connection-store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { getFolderName } from "@/utils/path-helpers";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs-store";

export const useProjectStore = create(
  combine(
    {
      projectName: "Explorer",
      rootFolderPath: undefined as string | undefined,
      activeProjectId: undefined as string | undefined,
    },
    (set, get) => ({
      setProjectName: (name: string) => set({ projectName: name }),
      setRootFolderPath: (path: string | undefined) => set({ rootFolderPath: path }),
      setActiveProjectId: (id: string | undefined) => set({ activeProjectId: id }),

      getProjectName: async () => {
        // Try to get from workspace tabs first
        const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
        if (activeTab) {
          const remoteInfo = parseRemotePath(activeTab.path);
          if (remoteInfo) {
            try {
              const connection = await connectionStore.getConnection(remoteInfo.connectionId);
              return connection ? `Remote: ${connection.name}` : activeTab.name;
            } catch {
              return activeTab.name;
            }
          }

          return activeTab.name;
        }

        const { rootFolderPath } = get();
        if (!rootFolderPath) return "Explorer";

        return getFolderName(rootFolderPath);
      },
    }),
  ),
);
