import { combine } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { getFolderName } from "@/utils/path-helpers";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";

const createProjectStore = () =>
  createStore(
    combine(
      {
        projectName: "Files",
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
          if (!rootFolderPath) return "Files";

          return getFolderName(rootFolderPath);
        },
      }),
    ),
  );

export const useProjectStore = createWorkspaceScopedStore("project", createProjectStore);
