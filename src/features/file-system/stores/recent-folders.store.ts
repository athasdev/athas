import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import type { RecentFolder, RecentFolderMetadata } from "../types/recent-folders.types";
import {
  toggleRecentFolderPinned,
  uniqueRecentFolderImports,
  updateRecentFolderMetadata,
  upsertRecentFolder,
} from "../utils/recent-folders";

export interface RecentFolderImport {
  path: string;
  sourceId?: string;
  sourceName?: string;
}

interface RecentFoldersState {
  recentFolders: RecentFolder[];
}

interface RecentFoldersActions {
  addToRecents: (folderPath: string, metadata?: RecentFolderMetadata) => void;
  importRecentFolders: (folders: RecentFolderImport[]) => number;
  openRecentFolder: (folderPath: string) => Promise<void>;
  removeFromRecents: (folderPath: string) => void;
  clearRecents: () => void;
  togglePinned: (folderPath: string) => void;
  updateRecentFolder: (folderPath: string, metadata: RecentFolderMetadata) => void;
}

export const useRecentFoldersStore = create<RecentFoldersState & RecentFoldersActions>()(
  immer(
    persist(
      (set, get) => ({
        recentFolders: [],

        addToRecents: (folderPath: string, metadata: RecentFolderMetadata = {}) => {
          set((state) => {
            state.recentFolders = upsertRecentFolder(state.recentFolders, folderPath, metadata);
          });
        },

        importRecentFolders: (folders: RecentFolderImport[]) => {
          const uniqueFolders = uniqueRecentFolderImports(folders);
          const existingPaths = new Set(get().recentFolders.map((folder) => folder.path));
          const importedFolders = uniqueFolders.filter((folder) => !existingPaths.has(folder.path));

          if (importedFolders.length === 0) {
            return 0;
          }

          const importBaseTime = Date.now() - 60_000;
          set((state) => {
            state.recentFolders = importedFolders.reduce(
              (recentFolders, folder, index) =>
                upsertRecentFolder(recentFolders, folder.path, {
                  lastOpenedAt: importBaseTime - index,
                  missing: false,
                  importSourceId: folder.sourceId,
                  importSourceName: folder.sourceName,
                }),
              state.recentFolders,
            );
          });

          return importedFolders.length;
        },

        openRecentFolder: async (folderPath: string) => {
          try {
            const { getSymlinkInfo } = await import("../controllers/platform");
            const { useFileSystemStore } = await import("../stores/file-system.store");
            const { handleOpenFolderByPath, rootFolderPath } = useFileSystemStore.getState();
            const { settings } = useSettingsStore.getState();
            const hasOpenWorkspace =
              !!rootFolderPath || useFileSystemStore.getState().files.length > 0;

            try {
              const pathInfo = await getSymlinkInfo(folderPath);
              if (!pathInfo.is_dir) {
                get().updateRecentFolder(folderPath, { missing: true });
                const { toast } = await import("@/ui/toast");
                toast.error(`Recent project is not a folder: ${folderPath}`);
                return;
              }
            } catch (error) {
              get().updateRecentFolder(folderPath, { missing: true });
              console.error("Recent folder is no longer available:", folderPath, error);
              const { toast } = await import("@/ui/toast");
              toast.error(`Recent project is unavailable: ${folderPath}`);
              return;
            }

            if (settings.openFoldersInNewWindow && hasOpenWorkspace) {
              await createAppWindow({
                path: folderPath,
                isDirectory: true,
              });
              get().addToRecents(folderPath, {
                missing: false,
                openInNewWindow: true,
              });
              return;
            }

            const opened = await handleOpenFolderByPath(folderPath);
            if (opened) {
              get().addToRecents(folderPath, {
                missing: false,
                openInNewWindow: false,
              });
            }
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

        togglePinned: (folderPath: string) => {
          set((state) => {
            state.recentFolders = toggleRecentFolderPinned(state.recentFolders, folderPath);
          });
        },

        updateRecentFolder: (folderPath: string, metadata: RecentFolderMetadata) => {
          set((state) => {
            state.recentFolders = updateRecentFolderMetadata(
              state.recentFolders,
              folderPath,
              metadata,
            );
          });
        },
      }),
      {
        name: "athas-code-recent-folders",
        version: 2,
        migrate: (persistedState) => {
          if (!persistedState || typeof persistedState !== "object") {
            return persistedState;
          }

          const state = persistedState as RecentFoldersState;
          if (!Array.isArray(state.recentFolders)) {
            return persistedState;
          }

          return {
            ...state,
            recentFolders: state.recentFolders.map((folder) => ({
              ...folder,
              lastOpenedAt:
                folder.lastOpenedAt ??
                (Number.isNaN(Date.parse(folder.lastOpened))
                  ? Date.now()
                  : Date.parse(folder.lastOpened)),
            })),
          };
        },
      },
    ),
  ),
);
