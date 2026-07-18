export const canUseNativeFileSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) &&
  !rootPath?.startsWith("remote://") &&
  !rootPath?.startsWith("wsl://") &&
  !rootPath?.startsWith("diff://");

export const canUseProviderFileSearch = (rootPath: string | null | undefined): rootPath is string =>
  typeof rootPath === "string" && rootPath.startsWith("wsl://");
