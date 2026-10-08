interface DroppedPathInfo {
  is_dir: boolean;
}

interface OpenDroppedWorkspacePathsOptions {
  getPathInfo: (path: string) => Promise<DroppedPathInfo>;
  openFolder?: (path: string) => Promise<boolean> | boolean;
  openFile?: (path: string) => Promise<boolean> | boolean;
  onError?: (path: string, error: unknown) => void;
}

export interface OpenDroppedWorkspacePathsResult {
  openedFolderCount: number;
  openedFileCount: number;
  failedPathCount: number;
}

export async function openDroppedWorkspacePaths(
  paths: string[],
  options: OpenDroppedWorkspacePathsOptions,
): Promise<OpenDroppedWorkspacePathsResult> {
  const result: OpenDroppedWorkspacePathsResult = {
    openedFolderCount: 0,
    openedFileCount: 0,
    failedPathCount: 0,
  };

  for (const path of paths) {
    try {
      const info = await options.getPathInfo(path);

      if (info?.is_dir) {
        if (options.openFolder && (await options.openFolder(path)) !== false) {
          result.openedFolderCount += 1;
        }
        continue;
      }

      if (options.openFile && (await options.openFile(path)) !== false) {
        result.openedFileCount += 1;
      }
    } catch (error) {
      result.failedPathCount += 1;
      options.onError?.(path, error);
    }
  }

  return result;
}
