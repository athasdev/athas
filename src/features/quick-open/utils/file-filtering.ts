import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import { shouldIgnoreInCommandPalette } from "../constants/ignored-patterns";
import { getBaseName, normalizePath, pathStartsWithRoot } from "@/utils/path-helpers";

/**
 * Check if a file should be ignored in Quick Open
 * @param filePath - The full file path
 * @returns true if the file should be ignored
 */
export const shouldIgnoreFile = (filePath: string): boolean => {
  const fileName = getBaseName(filePath, "");

  // Check if any directory in the path should be ignored
  const pathParts = normalizePath(filePath).split("/");
  for (const part of pathParts) {
    if (shouldIgnoreInCommandPalette(part, true)) {
      return true;
    }
  }

  // Check the filename itself
  return shouldIgnoreInCommandPalette(fileName, false);
};

export const filterQuickOpenRecentFiles = (
  recentFiles: readonly RecentFile[],
  rootFolderPath: string | null | undefined,
  indexedFilePaths: ReadonlySet<string>,
  hasLoadedFiles: boolean,
): RecentFile[] =>
  recentFiles.filter((file) => {
    const belongsToWorkspace =
      !rootFolderPath ||
      file.workspacePath === rootFolderPath ||
      pathStartsWithRoot(file.path, rootFolderPath);

    if (!belongsToWorkspace) return false;
    if (!hasLoadedFiles || file.external) return true;
    return indexedFilePaths.has(file.path);
  });
