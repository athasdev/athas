import { create } from "zustand";
import { combine } from "zustand/middleware";
import { connectionStore } from "@/utils/connection-store";
import { getFolderName } from "@/utils/path-helpers";
import { useWorkspaceTabsStore } from "./workspace-tabs-store";

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
        // Check if this is a remote window
        const urlParams = new URLSearchParams(window.location.search);
        const remoteConnectionId = urlParams.get("remote");

        if (remoteConnectionId) {
          try {
            const connection = await connectionStore.getConnection(remoteConnectionId);
            return connection ? `Remote: ${connection.name}` : "Remote";
          } catch {
            return "Remote";
          }
        }

        // Try to get from workspace tabs first
        const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
        if (activeTab) {
          return activeTab.name;
        }

        const { rootFolderPath } = get();
        if (!rootFolderPath) return "Explorer";

        return getFolderName(rootFolderPath);
      },
    }),
  ),
);
