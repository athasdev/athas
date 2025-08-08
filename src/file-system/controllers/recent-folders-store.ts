import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { RecentFolder } from "../models/recent-folders";

interface RecentFoldersState {
  recentFolders: RecentFolder[];
}

interface RecentFoldersActions {
  addToRecents: (folderPath: string) => void;
  openRecentFolder: (folderPath: string) => Promise<void>;
  removeFromRecents: (folderPath: string) => void;
  clearRecents: () => void;
}

export const useRecentFoldersStore = create<RecentFoldersState & RecentFoldersActions>()(
  immer(
    persist(
      (set, get) => ({
        recentFolders: [],

        addToRecents: (folderPath: string) => {
          const pathSeparator = folderPath.includes("\\") ? "\\" : "/";
          const folderName = folderPath.split(pathSeparator).pop() || folderPath;
          const now = new Date();
          const timeString = now.toLocaleString();

          const newFolder: RecentFolder = {
            name: folderName,
            path: folderPath,
            lastOpened: timeString,
          };

          set((state) => {
            // Remove existing entry if it exists
            state.recentFolders = state.recentFolders.filter((f) => f.path !== folderPath);
            // Add new entry at the beginning
            state.recentFolders.unshift(newFolder);
            // Keep only 5 most recent
            state.recentFolders = state.recentFolders.slice(0, 5);
          });
        },

        openRecentFolder: async (folderPath: string) => {
          try {
            const { useFileSystemStore } = await import("./store");
            const { handleOpenFolderByPath } = useFileSystemStore.getState();
            await handleOpenFolderByPath(folderPath);
            get().addToRecents(folderPath);
          } catch (error) {
            console.error("Error opening recent folder:", error);
          }
        },

        removeFromRecents: (folderPath: string) => {
          set((state) => {
            state.recentFolders = state.recentFolders.filter((f) => f.path !== folderPath);
          });
        },

        clearRecents: () => {
          set((state) => {
            state.recentFolders = [];
          });
        },
      }),
      {
        name: "athas-code-recent-folders",
        version: 1,
      },
    ),
  ),
);
