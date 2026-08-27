import { describe, expect, it, vi } from "vite-plus/test";
import {
  createWorkspaceBackgroundInitializer,
  type WorkspaceBackgroundInitializationOptions,
} from "../services/workspace-background-initializer";

function createHarness() {
  const events: string[] = [];
  let monotonicTime = 0;
  const options: WorkspaceBackgroundInitializationOptions<{ branch: string }> = {
    path: "/workspace",
    waitForIdle: vi.fn(async () => {
      events.push("idle");
    }),
    canContinue: vi.fn(() => true),
    canCommitGitStatus: vi.fn(() => true),
    shouldResetGitStatusAfterError: vi.fn(() => true),
    resetGitStatus: vi.fn(() => {
      events.push("reset-git");
    }),
    setProjectRoot: vi.fn(async () => {
      events.push("set-project-root");
    }),
    startFileSearchSync: vi.fn(() => {
      events.push("start-file-search");
    }),
    getGitStatusSnapshot: vi.fn(() => ({ repoPath: null, updatedAt: 0 })),
    readGitStatus: vi.fn(async () => {
      events.push("read-git-status");
      return { branch: "main" };
    }),
    commitGitStatus: vi.fn(() => {
      events.push("commit-git-status");
    }),
    trace: vi.fn((phase: string, step: string) => {
      events.push(`trace:${phase}:${step}`);
    }),
    onError: vi.fn(),
    getMonotonicTime: () => ++monotonicTime,
    getWallTime: () => 20_000,
  };

  return {
    events,
    options,
  };
}

describe("workspace background initializer", () => {
  it("runs watcher, search, and Git initialization in staged order", async () => {
    const initializer = createWorkspaceBackgroundInitializer();
    const harness = createHarness();

    await expect(initializer.start(harness.options)).resolves.toBe("completed");
    expect(harness.events).toEqual([
      "reset-git",
      "trace:start:backgroundInit",
      "trace:start:setProjectRoot",
      "set-project-root",
      "trace:end:setProjectRoot",
      "idle",
      "start-file-search",
      "idle",
      "trace:start:getGitStatus",
      "read-git-status",
      "trace:end:getGitStatus",
      "commit-git-status",
      "trace:end:backgroundInit",
    ]);
  });

  it("defers watcher startup and cancels an invalidated activation", async () => {
    const initializer = createWorkspaceBackgroundInitializer();
    const harness = createHarness();
    let resumeIdle: (() => void) | undefined;
    harness.options.deferWatcher = true;
    harness.options.waitForIdle = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resumeIdle = resolve;
        }),
    );

    const initialization = initializer.start(harness.options);
    initializer.invalidate();
    resumeIdle?.();

    await expect(initialization).resolves.toBe("cancelled");
    expect(harness.options.setProjectRoot).not.toHaveBeenCalled();
  });

  it("reuses a fresh cached Git status when preservation is requested", async () => {
    const initializer = createWorkspaceBackgroundInitializer();
    const harness = createHarness();
    harness.options.preserveGitStatus = true;
    vi.mocked(harness.options.getGitStatusSnapshot).mockReturnValue({
      repoPath: "/workspace",
      updatedAt: 10_000,
    });

    await expect(initializer.start(harness.options)).resolves.toBe("cached");
    expect(harness.options.resetGitStatus).not.toHaveBeenCalled();
    expect(harness.options.readGitStatus).not.toHaveBeenCalled();
    expect(harness.options.commitGitStatus).not.toHaveBeenCalled();
  });

  it("does not commit a Git result after the activation is invalidated", async () => {
    const initializer = createWorkspaceBackgroundInitializer();
    const harness = createHarness();
    let finishGitRead: ((status: { branch: string }) => void) | undefined;
    harness.options.readGitStatus = vi.fn(
      () =>
        new Promise<{ branch: string }>((resolve) => {
          finishGitRead = resolve;
        }),
    );

    const initialization = initializer.start(harness.options);
    await vi.waitFor(() => expect(harness.options.readGitStatus).toHaveBeenCalled());
    initializer.invalidate();
    finishGitRead?.({ branch: "main" });

    await expect(initialization).resolves.toBe("cancelled");
    expect(harness.options.commitGitStatus).not.toHaveBeenCalled();
  });

  it("resets Git state and reports pipeline failures", async () => {
    const initializer = createWorkspaceBackgroundInitializer();
    const harness = createHarness();
    const error = new Error("watcher failed");
    vi.mocked(harness.options.setProjectRoot).mockRejectedValue(error);

    await expect(initializer.start(harness.options)).resolves.toBe("failed");
    expect(harness.options.resetGitStatus).toHaveBeenCalledTimes(2);
    expect(harness.options.trace).toHaveBeenCalledWith("error", "backgroundInit", 1);
    expect(harness.options.onError).toHaveBeenCalledWith(error);
  });
});
