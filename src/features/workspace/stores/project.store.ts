import { combine } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import type { WorkspaceFolderSession } from "@/features/workspace/types/workspace-session.types";
import { getFolderName } from "@/utils/path-helpers";
import { normalizeWorkspaceRootPath } from "@/features/workspace/services/project-tab-path";

export type WorkspaceFolder = WorkspaceFolderSession;

/**
 * The one owner of a workspace's root: its primary folder, every folder added to it, and the
 * name shown for it. The store is workspace scoped, so each open project tab has its own copy;
 * the file tree, git, terminals, and agents read the root from here instead of keeping theirs.
 */
const createProjectStore = () =>
  createStore(
    combine(
      {
        projectName: "Files",
        rootFolderPath: undefined as string | undefined,
        workspaceFolders: [] as WorkspaceFolder[],
      },
      (set) => ({
        actions: {
          setProjectName: (name: string) => set({ projectName: name }),
          /**
           * Opens `path` as the root (normalized, see `normalizeWorkspaceRootPath`), with it as
           * the only workspace folder. `undefined` or an empty path closes the root.
           */
          setRootFolderPath: (path: string | undefined, folderName?: string) => {
            const rootFolderPath = path ? normalizeWorkspaceRootPath(path) : undefined;
            set({
              rootFolderPath,
              workspaceFolders: rootFolderPath
                ? [
                    {
                      path: rootFolderPath,
                      name: folderName ?? getFolderName(rootFolderPath),
                      isPrimary: true,
                    },
                  ]
                : [],
            });
          },
          setWorkspaceFolders: (workspaceFolders: WorkspaceFolder[]) => set({ workspaceFolders }),
        },
      }),
    ),
  );

export const useProjectStore = createWorkspaceScopedStore("project", createProjectStore);
