import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createWorkspaceSessionSaveQueue } from "../persistence/workspace-session-save-queue";

describe("createWorkspaceSessionSaveQueue", () => {
  it("periodically persists the latest session during continuous activity", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);
    for (let index = 0; index < 25; index++) {
      queue.schedule("/workspace-a", index);
      vi.advanceTimersByTime(40);
    }
    expect(save).toHaveBeenCalledExactlyOnceWith("/workspace-a", 24);
    queue.schedule("/workspace-a", 25);
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenLastCalledWith("/workspace-a", 25);
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps saves isolated per workspace", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);

    queue.schedule("/workspace-a", { activeBufferId: "a1" });
    queue.schedule("/workspace-b", { activeBufferId: "b1" });

    vi.advanceTimersByTime(50);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, "/workspace-a", { activeBufferId: "a1" });
    expect(save).toHaveBeenNthCalledWith(2, "/workspace-b", { activeBufferId: "b1" });
  });

  it("coalesces repeated saves for the same workspace", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);

    queue.schedule("/workspace-a", { activeBufferId: "a1" });
    vi.advanceTimersByTime(25);
    queue.schedule("/workspace-a", { activeBufferId: "a2" });
    vi.advanceTimersByTime(50);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("/workspace-a", { activeBufferId: "a2" });
  });

  it("can clear a queued save before it flushes", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);

    queue.schedule("/workspace-a", { activeBufferId: "a1" });
    queue.clear("/workspace-a");
    vi.advanceTimersByTime(50);

    expect(save).not.toHaveBeenCalled();
  });

  it("persists falsy payloads", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);

    queue.schedule("/workspace-a", false);
    vi.advanceTimersByTime(50);

    expect(save).toHaveBeenCalledWith("/workspace-a", false);
  });
});
