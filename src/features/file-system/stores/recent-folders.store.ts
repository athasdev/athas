import { commands } from "@/bindings/commands";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { IS_MAC } from "@/utils/platform";
import { createSelectors } from "@/utils/zustand-selectors";
import { createSafeJSONStorage } from "@/utils/zustand-storage";
import type { RecentFolder, RecentFolderMetadata } from "../types/recent-folders.types";
import {
  removeMissingRecentFolders,
  toggleRecentFolderPinned,
  uniqueRecentFolderImports,
  updateRecentFolderMetadata,
  upsertRecentFolder,
} from "../utils/recent-folders";

interface RecentFolderImport {
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
  removeFromRecents: (folderPath: string) => void;
  removeMissingFromRecents: () => void;
  clearRecents: () => void;
  togglePinned: (folderPath: string) => void;
  updateRecentFolder: (folderPath: string, metadata: RecentFolderMetadata) => void;
}

interface RecentFoldersStore extends RecentFoldersState {
  actions: RecentFoldersActions;
}

const useRecentFoldersStoreBase = create<RecentFoldersStore>()(
  immer(
    persist(
      (set, get) => ({
        recentFolders: [],

        actions: {
          addToRecents: (folderPath: string, metadata: RecentFolderMetadata = {}) => {
            set((state) => {
              state.recentFolders = upsertRecentFolder(state.recentFolders, folderPath, metadata);
            });

            if (IS_MAC && typeof window !== "undefined") {
              void commands.noteRecentDocument(folderPath).catch((error) => {
                console.error("Failed to update the macOS Open Recent menu:", error);
              });
            }
          },

          importRecentFolders: (folders: RecentFolderImport[]) => {
            const uniqueFolders = uniqueRecentFolderImports(folders);
            const existingPaths = new Set(get().recentFolders.map((folder) => folder.path));
            const importedFolders = uniqueFolders.filter(
              (folder) => !existingPaths.has(folder.path),
            );

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

          removeFromRecents: (folderPath: string) => {
            set((state) => {
              state.recentFolders = state.recentFolders.filter((f) => f.path !== folderPath);
            });
          },

          removeMissingFromRecents: () => {
            set((state) => {
              state.recentFolders = removeMissingRecentFolders(state.recentFolders);
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
        },
      }),
      {
        name: "athas-code-recent-folders",
        version: 2,
        storage: createSafeJSONStorage<RecentFoldersState>(),
        partialize: ({ recentFolders }) => ({ recentFolders }),
        merge: (persistedState, currentState) => ({
          ...currentState,
          ...(persistedState as RecentFoldersState),
          actions: currentState.actions,
        }),
        migrate: (persistedState): RecentFoldersState => {
          if (!persistedState || typeof persistedState !== "object") {
            return { recentFolders: [] };
          }

          const state = persistedState as RecentFoldersState;
          if (!Array.isArray(state.recentFolders)) {
            return { recentFolders: [] };
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

export const useRecentFoldersStore = createSelectors(useRecentFoldersStoreBase);
