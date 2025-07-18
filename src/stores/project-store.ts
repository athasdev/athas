import { create } from "zustand";
import { combine } from "zustand/middleware";

const initialState = {
  projectName: "Explorer",
  rootFolderPath: undefined as string | undefined,
};

export const useProjectStore = create(
  combine(initialState, (set, get) => ({
    setProjectName: (name: string) => set({ projectName: name }),
    setRootFolderPath: (path: string | undefined) => set({ rootFolderPath: path }),

    getProjectName: () => {
      const { rootFolderPath } = get();
      if (!rootFolderPath) return "Explorer";

      const normalizedPath = rootFolderPath.replace(/\\/g, "/");
      const folderName = normalizedPath.split("/").pop();
      return folderName || "Folder";
    },

    reset: () => set(initialState),
  })),
);
