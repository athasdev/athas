import type { RecentFolder, RecentFolderMetadata } from "../types/recent-folders.types";

export const MAX_RECENT_PROJECTS = 12;

function getFolderName(folderPath: string) {
  const pathSeparator = folderPath.includes("\\") ? "\\" : "/";
  return folderPath.split(pathSeparator).filter(Boolean).pop() || folderPath;
}

function formatLastOpened(timestamp: number) {
  return new Date(timestamp).toLocaleString();
}

function getLastOpenedAt(folder: RecentFolder) {
  const parsed = Date.parse(folder.lastOpened);
  return folder.lastOpenedAt ?? (Number.isNaN(parsed) ? Date.now() : parsed);
}

function normalizeRecentFolder(folder: RecentFolder): RecentFolder {
  return {
    ...folder,
    lastOpenedAt: getLastOpenedAt(folder),
  };
}

export function sortRecentFolders(folders: RecentFolder[]) {
  return [...folders].sort((left, right) => {
    if (!!left.pinned !== !!right.pinned) {
      return left.pinned ? -1 : 1;
    }

    return (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0);
  });
}

export function limitRecentFolders(folders: RecentFolder[]) {
  const sorted = sortRecentFolders(folders.map(normalizeRecentFolder));
  const pinned = sorted.filter((folder) => folder.pinned);
  const unpinned = sorted.filter((folder) => !folder.pinned).slice(0, MAX_RECENT_PROJECTS);

  return [...pinned, ...unpinned];
}

export function uniqueRecentFolderImports<T extends { path: string }>(folders: T[]) {
  const seenPaths = new Set<string>();
  const uniqueFolders: T[] = [];

  for (const folder of folders) {
    if (seenPaths.has(folder.path)) {
      continue;
    }

    seenPaths.add(folder.path);
    uniqueFolders.push(folder);
  }

  return uniqueFolders;
}

export function upsertRecentFolder(
  folders: RecentFolder[],
  folderPath: string,
  metadata: RecentFolderMetadata = {},
): RecentFolder[] {
  const existing = folders.find((folder) => folder.path === folderPath);
  const lastOpenedAt = metadata.lastOpenedAt ?? Date.now();
  const nextFolder: RecentFolder = {
    name: existing?.name ?? getFolderName(folderPath),
    path: folderPath,
    lastOpened: formatLastOpened(lastOpenedAt),
    lastOpenedAt,
    activeProjectTabId: metadata.activeProjectTabId ?? existing?.activeProjectTabId,
    customIcon: metadata.customIcon ?? existing?.customIcon,
    missing: metadata.missing ?? false,
    openInNewWindow: metadata.openInNewWindow ?? existing?.openInNewWindow,
    pinned: existing?.pinned,
    importSourceId: metadata.importSourceId ?? existing?.importSourceId,
    importSourceName: metadata.importSourceName ?? existing?.importSourceName,
  };

  return limitRecentFolders([
    nextFolder,
    ...folders.filter((folder) => folder.path !== folderPath),
  ]);
}

export function updateRecentFolderMetadata(
  folders: RecentFolder[],
  folderPath: string,
  metadata: RecentFolderMetadata,
) {
  return limitRecentFolders(
    folders.map((folder) =>
      folder.path === folderPath
        ? {
            ...folder,
            ...metadata,
          }
        : folder,
    ),
  );
}

export function toggleRecentFolderPinned(folders: RecentFolder[], folderPath: string) {
  return limitRecentFolders(
    folders.map((folder) =>
      folder.path === folderPath
        ? {
            ...folder,
            pinned: !folder.pinned,
          }
        : folder,
    ),
  );
}
