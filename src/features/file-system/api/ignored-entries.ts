import { commands } from "@/bindings/commands";
import { parseRemotePath } from "@/features/remote/services/remote-path";
import { parseWslPath } from "@/features/wsl/services/wsl-path";
import { logger } from "@/utils/logger";
import type { FileEntry } from "../types/app.types";

const NO_IGNORED_NAMES: ReadonlySet<string> = new Set();

/**
 * Names of the entries of a local or WSL directory that the workspace's ignore files exclude.
 * A remote directory, or one whose ignore files cannot be read, is listed as if nothing in it
 * were ignored.
 */
export async function readIgnoredEntryNames(
  directoryPath: string,
  workspaceRoot: string,
): Promise<ReadonlySet<string>> {
  if (parseRemotePath(directoryPath)) return NO_IGNORED_NAMES;
  try {
    const wslDirectory = parseWslPath(directoryPath);
    if (!wslDirectory) {
      return new Set(await commands.localIgnoredEntryNames(directoryPath, workspaceRoot));
    }

    const wslRoot = parseWslPath(workspaceRoot);
    if (wslRoot?.distro !== wslDirectory.distro) return NO_IGNORED_NAMES;
    return new Set(
      await commands.wslIgnoredEntryNames(
        wslDirectory.distro,
        wslDirectory.linuxPath,
        wslRoot.linuxPath,
      ),
    );
  } catch (error) {
    logger.debug("FileSystem", `Could not read ignore rules for ${directoryPath}`, error);
    return NO_IGNORED_NAMES;
  }
}

export function markIgnoredEntries(
  entries: FileEntry[],
  ignoredNames: ReadonlySet<string>,
): FileEntry[] {
  if (ignoredNames.size === 0) return entries;
  return entries.map((entry) =>
    ignoredNames.has(entry.name) ? { ...entry, ignored: true } : entry,
  );
}

/** Marks the entries of `directoryPath` the file tree shows dimmed or hides as ignored. */
export async function markIgnoredEntriesIn(
  directoryPath: string,
  workspaceRoot: string,
  entries: Promise<FileEntry[]>,
): Promise<FileEntry[]> {
  const [listed, ignoredNames] = await Promise.all([
    entries,
    readIgnoredEntryNames(directoryPath, workspaceRoot),
  ]);
  return markIgnoredEntries(listed, ignoredNames);
}
