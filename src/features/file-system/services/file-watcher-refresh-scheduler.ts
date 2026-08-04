const pendingRefreshes = new Map<string, ReturnType<typeof setTimeout>>();
const REFRESH_DEBOUNCE_MS = 300;

function getRefreshKey(workspaceId: string, directoryPath: string) {
  return `${workspaceId}\0${directoryPath}`;
}

export function scheduleFileWatcherRefresh(
  workspaceId: string,
  directoryPath: string,
  refresh: () => void | Promise<void>,
) {
  const refreshKey = getRefreshKey(workspaceId, directoryPath);
  const existingRefresh = pendingRefreshes.get(refreshKey);
  if (existingRefresh) {
    clearTimeout(existingRefresh);
  }

  pendingRefreshes.set(
    refreshKey,
    setTimeout(() => {
      pendingRefreshes.delete(refreshKey);
      void refresh();
    }, REFRESH_DEBOUNCE_MS),
  );
}

export function cancelFileWatcherRefreshes(workspaceId?: string) {
  const workspacePrefix = workspaceId ? `${workspaceId}\0` : null;

  for (const [refreshKey, timeout] of pendingRefreshes) {
    if (workspacePrefix && !refreshKey.startsWith(workspacePrefix)) {
      continue;
    }

    clearTimeout(timeout);
    pendingRefreshes.delete(refreshKey);
  }
}
