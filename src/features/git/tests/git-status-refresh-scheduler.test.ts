import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createGitStatusRefreshScheduler } from "../services/git-status-refresh-scheduler";

const save = { source: "auto-save" };
const external = { source: "external-file-change" };

describe("git status refresh scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes shortly after a change that is not one of our saves", () => {
    const refresh = vi.fn();
    const scheduler = createGitStatusRefreshScheduler(refresh);

    scheduler.schedule(external);
    vi.advanceTimersByTime(299);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("coalesces autosaves into one trailing refresh", () => {
    const refresh = vi.fn();
    const scheduler = createGitStatusRefreshScheduler(refresh);

    for (let index = 0; index < 4; index++) {
      scheduler.schedule(save);
      vi.advanceTimersByTime(1000);
    }
    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("still refreshes during a long run of saves", () => {
    const refresh = vi.fn();
    const scheduler = createGitStatusRefreshScheduler(refresh);

    for (let index = 0; index < 10; index++) {
      scheduler.schedule(save);
      vi.advanceTimersByTime(1000);
    }

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("lets a sooner refresh for another change cover a pending save", () => {
    const refresh = vi.fn();
    const scheduler = createGitStatusRefreshScheduler(refresh);

    scheduler.schedule(save);
    scheduler.schedule(external);
    scheduler.schedule(save);
    vi.advanceTimersByTime(300);
    expect(refresh).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("drops a pending refresh when disposed", () => {
    const refresh = vi.fn();
    const scheduler = createGitStatusRefreshScheduler(refresh);

    scheduler.schedule(save);
    scheduler.dispose();
    vi.advanceTimersByTime(5000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
