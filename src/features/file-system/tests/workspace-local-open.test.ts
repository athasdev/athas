import { describe, expect, it, vi } from "vite-plus/test";
import {
  openLocalWorkspaceTransaction,
  type LocalWorkspaceOpenOptions,
} from "../services/workspace-local-open";

function createHarness() {
  const events: string[] = [];
  const options: LocalWorkspaceOpenOptions<{ root: string }> = {
    replacingCurrentWorkspace: true,
    currentBufferIds: ["buffer-1", "buffer-2"],
    prepareTransition: vi.fn(async () => {
      events.push("prepare-transition");
      return true;
    }),
    persistCurrentSession: vi.fn(() => {
      events.push("persist-current-session");
    }),
    closeCurrentBuffers: vi.fn(() => {
      events.push("close-current-buffers");
    }),
    persistCurrentUiState: vi.fn(() => {
      events.push("persist-current-ui-state");
    }),
    setLoading: vi.fn((isLoading) => {
      events.push(`loading:${isLoading}`);
    }),
    loadWorkspace: vi.fn(async () => {
      events.push("load-workspace");
      return { root: "/workspace" };
    }),
    applyWorkspace: vi.fn(() => {
      events.push("apply-workspace");
    }),
    restoreSession: vi.fn(async () => {
      events.push("restore-session");
    }),
    startBackgroundInitialization: vi.fn(() => {
      events.push("start-background-initialization");
    }),
    onOpenError: vi.fn(),
    onRestoreError: vi.fn(),
  };

  return { events, options };
}

describe("local workspace open transaction", () => {
  it("prepares replacement state before loading and restoring a workspace", async () => {
    const harness = createHarness();

    await expect(openLocalWorkspaceTransaction(harness.options)).resolves.toBe("opened");
    expect(harness.events).toEqual([
      "prepare-transition",
      "persist-current-session",
      "close-current-buffers",
      "loading:true",
      "load-workspace",
      "apply-workspace",
      "restore-session",
      "start-background-initialization",
    ]);
    expect(harness.options.closeCurrentBuffers).toHaveBeenCalledWith(["buffer-1", "buffer-2"]);
  });

  it("stops before mutating state when a replacement is cancelled", async () => {
    const harness = createHarness();
    vi.mocked(harness.options.prepareTransition).mockResolvedValue(false);

    await expect(openLocalWorkspaceTransaction(harness.options)).resolves.toBe("cancelled");
    expect(harness.events).toEqual([]);
    expect(harness.options.setLoading).not.toHaveBeenCalled();
    expect(harness.options.loadWorkspace).not.toHaveBeenCalled();
  });

  it("persists current UI state when opening without replacing a workspace", async () => {
    const harness = createHarness();
    harness.options.replacingCurrentWorkspace = false;

    await expect(openLocalWorkspaceTransaction(harness.options)).resolves.toBe("opened");
    expect(harness.events).toEqual([
      "persist-current-ui-state",
      "loading:true",
      "load-workspace",
      "apply-workspace",
      "restore-session",
      "start-background-initialization",
    ]);
    expect(harness.options.prepareTransition).not.toHaveBeenCalled();
    expect(harness.options.persistCurrentSession).not.toHaveBeenCalled();
    expect(harness.options.closeCurrentBuffers).not.toHaveBeenCalled();
  });

  it("resets loading and reports workspace load failures", async () => {
    const harness = createHarness();
    const error = new Error("read failed");
    vi.mocked(harness.options.loadWorkspace).mockRejectedValue(error);

    await expect(openLocalWorkspaceTransaction(harness.options)).resolves.toBe("failed");
    expect(harness.options.setLoading).toHaveBeenLastCalledWith(false);
    expect(harness.options.onOpenError).toHaveBeenCalledWith(error);
    expect(harness.options.restoreSession).not.toHaveBeenCalled();
    expect(harness.options.startBackgroundInitialization).not.toHaveBeenCalled();
  });

  it("reports restore failures without failing an opened workspace", async () => {
    const harness = createHarness();
    const error = new Error("restore failed");
    vi.mocked(harness.options.restoreSession).mockRejectedValue(error);

    await expect(openLocalWorkspaceTransaction(harness.options)).resolves.toBe("opened");
    expect(harness.options.onRestoreError).toHaveBeenCalledWith(error);
    expect(harness.options.startBackgroundInitialization).toHaveBeenCalledOnce();
  });
});
