import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import { pathStartsWithRoot } from "@/utils/path-helpers";

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
