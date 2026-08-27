import { describe, expect, it, vi } from "vite-plus/test";
import { resetWorkspaceResources } from "../services/workspace-reset";

function createResetHarness(bufferIds: string[] = ["buffer-a", "buffer-b"]) {
  const events: string[] = [];

  return {
    events,
    options: {
      bufferIds,
      resetFileSystemState: () => events.push("reset-file-system"),
      collapseFileTree: () => events.push("collapse-file-tree"),
      resetProjectMetadata: () => events.push("reset-project"),
      closeBuffer: (bufferId: string) => events.push(`close-buffer:${bufferId}`),
      stopFileWatcher: async () => {
        events.push("stop-file-watcher");
      },
      resetGitState: () => events.push("reset-git"),
      clearGitDiffCache: () => events.push("clear-git-diff"),
      clearGitBlame: () => events.push("clear-git-blame"),
    },
  };
}

describe("workspace reset", () => {
  it("resets workspace resources in lifecycle order", async () => {
    const harness = createResetHarness();

    await resetWorkspaceResources(harness.options);

    expect(harness.events).toEqual([
      "reset-file-system",
      "collapse-file-tree",
      "reset-project",
      "close-buffer:buffer-a",
      "close-buffer:buffer-b",
      "stop-file-watcher",
      "reset-git",
      "clear-git-diff",
      "clear-git-blame",
    ]);
  });

  it("still resets non-buffer resources when no buffers are open", async () => {
    const harness = createResetHarness([]);

    await resetWorkspaceResources(harness.options);

    expect(harness.events).toEqual([
      "reset-file-system",
      "collapse-file-tree",
      "reset-project",
      "stop-file-watcher",
      "reset-git",
      "clear-git-diff",
      "clear-git-blame",
    ]);
  });

  it("waits for the file watcher before clearing git state", async () => {
    let resumeFileWatcherStop: (() => void) | undefined;
    const stopFileWatcher = new Promise<void>((resolve) => {
      resumeFileWatcherStop = resolve;
    });
    const resetGitState = vi.fn();
    const harness = createResetHarness([]);
    const reset = resetWorkspaceResources({
      ...harness.options,
      stopFileWatcher: () => stopFileWatcher,
      resetGitState,
    });

    expect(resetGitState).not.toHaveBeenCalled();

    resumeFileWatcherStop?.();
    await reset;

    expect(resetGitState).toHaveBeenCalledOnce();
  });
});
