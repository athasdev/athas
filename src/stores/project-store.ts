import { create } from "zustand";
import { combine } from "zustand/middleware";
import { connectionStore } from "@/utils/connection-store";

export const useProjectStore = create(
  combine(
    {
      projectName: "Explorer",
      rootFolderPath: undefined as string | undefined,
    },
    (set, get) => ({
      setProjectName: (name: string) => set({ projectName: name }),
      setRootFolderPath: (path: string | undefined) => set({ rootFolderPath: path }),

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

        const { rootFolderPath } = get();
        if (!rootFolderPath) return "Explorer";

        const normalizedPath = rootFolderPath.replace(/\\/g, "/");
        const folderName = normalizedPath.split("/").pop();
        return folderName || "Folder";
      },
    }),
  ),
);
