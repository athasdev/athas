import { commands } from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";

const waitingPaths = new Map<string, Set<string>>();
let unsubscribe: (() => void) | null = null;

function openPaths() {
  const paths = new Set<string>();
  for (const store of useBufferStore.getAllStores()) {
    for (const buffer of store.getState().buffers) {
      if (buffer.path) paths.add(buffer.path);
    }
  }
  return paths;
}

function releaseClosedWaits() {
  const open = openPaths();
  for (const [marker, paths] of waitingPaths) {
    if ([...paths].some((path) => open.has(path))) continue;
    waitingPaths.delete(marker);
    void commands
      .releaseCliWait(marker)
      .catch((error) => console.error("Failed to release the waiting CLI:", error));
  }
  if (waitingPaths.size === 0) {
    unsubscribe?.();
    unsubscribe = null;
  }
}

/**
 * Lets an `athas --wait` CLI return once none of the files it opened is open in any project.
 * Call it after the file was opened; a file that failed to open releases the CLI right away.
 */
export function trackCliWait(marker: string, path: string) {
  const paths = waitingPaths.get(marker) ?? new Set<string>();
  paths.add(path);
  waitingPaths.set(marker, paths);
  unsubscribe ??= useBufferStore.subscribeAll(releaseClosedWaits);
  releaseClosedWaits();
}
