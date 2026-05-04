export const WORKSPACE_TABS_STORAGE_PREFIX = "workspace-tabs-storage-";

type WorkspaceTabsStorageReader = Pick<Storage, "key" | "length">;
type WorkspaceTabsStorageWriter = WorkspaceTabsStorageReader & Pick<Storage, "removeItem">;

export const getWorkspaceTabsStorageKey = (windowLabel: string) =>
  `${WORKSPACE_TABS_STORAGE_PREFIX}${windowLabel}`;

export const getWorkspaceTabsStorageLabel = (storageKey: string) => {
  if (!storageKey.startsWith(WORKSPACE_TABS_STORAGE_PREFIX)) {
    return null;
  }

  const label = storageKey.slice(WORKSPACE_TABS_STORAGE_PREFIX.length);
  return label.length > 0 ? label : null;
};

export const getStaleWorkspaceTabsStorageKeys = (
  storage: WorkspaceTabsStorageReader,
  activeWindowLabels: Iterable<string>,
) => {
  const activeLabels = new Set(activeWindowLabels);
  const staleKeys: string[] = [];

  for (let index = 0; index < storage.length; index += 1) {
    const storageKey = storage.key(index);
    if (!storageKey) {
      continue;
    }

    const windowLabel = getWorkspaceTabsStorageLabel(storageKey);
    if (windowLabel && !activeLabels.has(windowLabel)) {
      staleKeys.push(storageKey);
    }
  }

  return staleKeys;
};

export const removeStaleWorkspaceTabsStorageKeys = (
  storage: WorkspaceTabsStorageWriter,
  activeWindowLabels: Iterable<string>,
) => {
  const staleKeys = getStaleWorkspaceTabsStorageKeys(storage, activeWindowLabels);

  for (const staleKey of staleKeys) {
    storage.removeItem(staleKey);
  }

  return staleKeys;
};
