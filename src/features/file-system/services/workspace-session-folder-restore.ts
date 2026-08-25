import {
  normalizeWorkspaceFolders,
  selectRestoredWorkspaceFolders,
  type WorkspaceFolderSession,
} from "@/features/file-system/controllers/workspace-session";
import type { FileEntry } from "@/features/file-system/types/app.types";

interface RestoreWorkspaceSessionFoldersOptions {
  projectPath: string;
  workspaceFolders: WorkspaceFolderSession[];
  currentRootPaths: ReadonlySet<string>;
  readRootEntry: (path: string) => Promise<FileEntry>;
  onFolderError?: (folder: WorkspaceFolderSession, error: unknown) => void;
}

interface RestoredWorkspaceSessionFolders {
  rootEntries: FileEntry[];
  workspaceFolders: WorkspaceFolderSession[];
}

export async function restoreWorkspaceSessionFolders({
  projectPath,
  workspaceFolders,
  currentRootPaths,
  readRootEntry,
  onFolderError,
}: RestoreWorkspaceSessionFoldersOptions): Promise<RestoredWorkspaceSessionFolders> {
  const foldersToRestore = normalizeWorkspaceFolders(projectPath, workspaceFolders);
  const restoredFolders = (
    await Promise.all(
      foldersToRestore.map(async (folder) => {
        if (folder.path === projectPath || currentRootPaths.has(folder.path)) {
          return { path: folder.path, entry: null };
        }

        try {
          return {
            path: folder.path,
            entry: await readRootEntry(folder.path),
          };
        } catch (error) {
          onFolderError?.(folder, error);
          return null;
        }
      }),
    )
  ).filter((result): result is { path: string; entry: FileEntry | null } => result !== null);

  return {
    rootEntries: restoredFolders
      .map((result) => result.entry)
      .filter((entry): entry is FileEntry => entry !== null),
    workspaceFolders: selectRestoredWorkspaceFolders(
      projectPath,
      foldersToRestore,
      restoredFolders.map((result) => result.path),
    ),
  };
}
