import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clearQueuedWorkspaceSessionSave,
  saveSessionToStore,
} from "../stores/buffer-session-persistence";
import { useSessionStore } from "@/features/window/stores/session.store";

describe("buffer session persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSessionStore.setState({ sessions: {} });
  });

  afterEach(() => {
    clearQueuedWorkspaceSessionSave("/workspace-a");
    clearQueuedWorkspaceSessionSave("/workspace-b");
    vi.useRealTimers();
  });

  it("persists against the workspace captured by the caller", () => {
    saveSessionToStore("/workspace-a", [], null);
    saveSessionToStore("/workspace-b", [], null);

    vi.advanceTimersByTime(300);

    expect(useSessionStore.getState().actions.getSession("/workspace-a")?.projectPath).toBe(
      "/workspace-a",
    );
    expect(useSessionStore.getState().actions.getSession("/workspace-b")?.projectPath).toBe(
      "/workspace-b",
    );
  });
});
