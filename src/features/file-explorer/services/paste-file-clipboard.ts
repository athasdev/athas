import { useFileClipboardStore } from "@/features/file-explorer/stores/file-explorer-clipboard.store";
import { relocateOpenPaths } from "@/features/file-system/services/relocate-open-paths";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { getDirName } from "@/utils/path-helpers";

/**
 * Pastes the file clipboard into `targetDirectory` and brings the workspace up to date: the
 * target folder is read again, and after a cut the folders the entries left are too, while
 * open tabs follow the entries they show to where they now live.
 */
export async function pasteFileClipboard(
  targetDirectory: string,
  workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId(),
): Promise<void> {
  const operation = useFileClipboardStore.getState().clipboard?.operation;
  const pasted = await useFileClipboardStore.getState().actions.paste(targetDirectory);
  const fileSystem = useFileSystemStore.getStore(workspaceId).getState();
  const directories = new Set([targetDirectory]);

  if (pasted && operation === "cut") {
    for (const entry of pasted) {
      if (entry.source_path === entry.destination_path) continue;
      relocateOpenPaths(workspaceId, entry.source_path, entry.destination_path);
      directories.add(getDirName(entry.source_path));
    }
  }

  await Promise.all(
    [...directories].map((directory) =>
      fileSystem.refreshDirectory(directory, { force: true }).catch((error: unknown) => {
        console.error(`Failed to refresh ${directory} after paste:`, error);
      }),
    ),
  );
}
