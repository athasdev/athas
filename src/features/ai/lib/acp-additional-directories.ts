import { canUseNativeFileSearch } from "@/features/file-search/utils/file-search-paths";

/**
 * The workspace roots besides `workspacePath` that a chat's agent session should also cover,
 * sent as ACP `additionalDirectories`. Remote and virtual roots are left out, since the agent
 * runs on this machine and can only use local folders.
 */
export function getAcpAdditionalDirectories(
  workspacePath: string | null,
  workspaceFolders: readonly { path: string }[],
): string[] {
  const trim = (path: string) => path.replace(/[\\/]+$/, "");
  const primary = workspacePath ? trim(workspacePath) : null;
  const directories: string[] = [];
  for (const { path } of workspaceFolders) {
    if (!canUseNativeFileSearch(path)) continue;
    const directory = trim(path);
    if (directory === primary || directories.includes(directory)) continue;
    directories.push(directory);
  }
  return directories;
}
