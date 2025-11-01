import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { FileEntry } from "../../file-system/models/app";

interface FileTreeState {
  expandedFolders: Set<string>;
  selectedFiles: Set<string>;
  expandedPaths: Set<string>;
}

export const useFileTreeStore = create(
  immer(
    combine(
      {
        expandedFolders: new Set<string>(),
        selectedFiles: new Set<string>(),
        expandedPaths: new Set<string>(),
      } as FileTreeState,
      (set, get) => ({
        toggleFolder: (path: string) => {
          set((state) => {
            if (state.expandedFolders.has(path)) {
              state.expandedFolders.delete(path);
              state.expandedPaths.delete(path);
            } else {
              state.expandedFolders.add(path);
              state.expandedPaths.add(path);
            }
          });
        },

        selectFile: (path: string, multiSelect = false) => {
          set((state) => {
            if (multiSelect) {
              if (state.selectedFiles.has(path)) {
                state.selectedFiles.delete(path);
              } else {
                state.selectedFiles.add(path);
              }
            } else {
              state.selectedFiles.clear();
              state.selectedFiles.add(path);
            }
          });
        },

        clearSelection: () => {
          set((state) => {
            state.selectedFiles.clear();
          });
        },

        setExpandedPaths: (paths: Set<string>) => {
          set((state) => {
            state.expandedPaths = paths;
            state.expandedFolders = new Set(paths);
          });
        },

        getExpandedPaths: () => {
          return get().expandedPaths;
        },

        isExpanded: (path: string) => {
          return get().expandedFolders.has(path);
        },

        isSelected: (path: string) => {
          return get().selectedFiles.has(path);
        },

        expandToPath: (targetPath: string) => {
          set((state) => {
            const pathParts = targetPath.split(/[/\\]/);
            let currentPath = "";

            // Expand all parent folders leading to the target
            for (let i = 0; i < pathParts.length - 1; i++) {
              if (i === 0) {
                currentPath = pathParts[0];
              } else {
                currentPath += (targetPath.includes("\\") ? "\\" : "/") + pathParts[i];
              }
              state.expandedFolders.add(currentPath);
              state.expandedPaths.add(currentPath);
            }
          });
        },

        collapseAll: () => {
          set((state) => {
            state.expandedFolders.clear();
            state.expandedPaths.clear();
          });
        },

        expandAll: (files: FileEntry[]) => {
          set((state) => {
            const collectFolders = (items: FileEntry[]) => {
              for (const item of items) {
                if (item.isDir) {
                  state.expandedFolders.add(item.path);
                  state.expandedPaths.add(item.path);
                  if (item.children) {
                    collectFolders(item.children);
                  }
                }
              }
            };
            collectFolders(files);
          });
        },
      }),
    ),
  ),
);
