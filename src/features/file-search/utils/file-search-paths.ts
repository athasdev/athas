export const canUseNativeFileSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) &&
  !rootPath?.startsWith("remote://") &&
  !rootPath?.startsWith("wsl://") &&
  !rootPath?.startsWith("diff://");

export const canUseProviderFileSearch = (rootPath: string | null | undefined): rootPath is string =>
  typeof rootPath === "string" && rootPath.startsWith("wsl://");

export const getNativeWorkspaceRootPaths = (
  rootFolderPath: string | null | undefined,
  workspaceFolders: readonly ({ path: string } | string)[],
): string[] => {
  const roots = [
    rootFolderPath,
    ...workspaceFolders.map((folder) => (typeof folder === "string" ? folder : folder.path)),
  ];
  return Array.from(new Set(roots.filter(canUseNativeFileSearch)));
};
