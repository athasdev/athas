import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createWorkspaceSessionSaveQueue } from "../persistence/workspace-session-save-queue";

describe("createWorkspaceSessionSaveQueue", () => {
  it("leaves writes scheduled during an all-workspace flush for the next flush", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);
    save.mockImplementationOnce(() => queue.schedule("/a", "newer"));
    queue.schedule("/a", "original");
    queue.flush();
    expect(save).toHaveBeenCalledExactlyOnceWith("/a", "original");
    queue.flush();
    expect(save).toHaveBeenLastCalledWith("/a", "newer");
  });

  it("flushes the latest sessions before shutdown without repeating their timers", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);
    queue.schedule("/a", "old");
    queue.schedule("/a", "latest");
    queue.schedule("/b", "other");
    queue.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("/a", "latest");
    expect(save).toHaveBeenCalledWith("/b", "other");
    vi.advanceTimersByTime(100);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flushes one workspace while another keeps its pending timer", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);
    queue.schedule("/a", "a");
    queue.schedule("/b", "b");
    queue.flush("/a");
    expect(save).toHaveBeenCalledExactlyOnceWith("/a", "a");
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenLastCalledWith("/b", "b");
  });

  it("retains a failed write for retry without replacing a newer queued payload", () => {
    const save = vi.fn();
    const queue = createWorkspaceSessionSaveQueue(save, 50);
    save.mockImplementationOnce(() => {
      queue.schedule("/a", "newer");
      throw new Error("Storage full");
    });
    queue.schedule("/a", "original");
    expect(() => queue.flush("/a")).toThrow("Storage full");
    queue.flush("/a");
    expect(save).toHaveBeenLastCalledWith("/a", "newer");
    vi.advanceTimersByTime(50);
    expect(save).toHaveBeenCalledTimes(2);
  });

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
