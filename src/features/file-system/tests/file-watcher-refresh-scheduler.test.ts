import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  cancelFileWatcherRefreshes,
  scheduleFileWatcherRefresh,
} from "../services/file-watcher-refresh-scheduler";

describe("file watcher refresh scheduler", () => {
  afterEach(() => {
    cancelFileWatcherRefreshes();
    vi.useRealTimers();
  });

  it("debounces refreshes for the same workspace directory", async () => {
    vi.useFakeTimers();
    const firstRefresh = vi.fn();
    const latestRefresh = vi.fn();

    scheduleFileWatcherRefresh("workspace-a", "/project/src", firstRefresh);
    scheduleFileWatcherRefresh("workspace-a", "/project/src", latestRefresh);
    await vi.advanceTimersByTimeAsync(300);

    expect(firstRefresh).not.toHaveBeenCalled();
    expect(latestRefresh).toHaveBeenCalledOnce();
  });

  it("keeps a failed refresh from escaping as an unhandled rejection", async () => {
    vi.useFakeTimers();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const refresh = vi.fn(async () => {
      throw new Error("Failed to read directory /project/gone");
    });

    scheduleFileWatcherRefresh("workspace-a", "/project/gone", refresh);
    await vi.advanceTimersByTimeAsync(300);

    expect(refresh).toHaveBeenCalledOnce();
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to refresh /project/gone:",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("cancels only the closing workspace refreshes", async () => {
    vi.useFakeTimers();
    const closedWorkspaceRefresh = vi.fn();
    const activeWorkspaceRefresh = vi.fn();

    scheduleFileWatcherRefresh("workspace-a", "/project-a", closedWorkspaceRefresh);
    scheduleFileWatcherRefresh("workspace-b", "/project-b", activeWorkspaceRefresh);
    cancelFileWatcherRefreshes("workspace-a");
    await vi.advanceTimersByTimeAsync(300);

    expect(closedWorkspaceRefresh).not.toHaveBeenCalled();
    expect(activeWorkspaceRefresh).toHaveBeenCalledOnce();
  });
});
