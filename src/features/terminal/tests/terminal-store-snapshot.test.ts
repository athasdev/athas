import { afterEach, describe, expect, it } from "vite-plus/test";
import { useTerminalStore } from "../stores/terminal-store";
import type { TerminalViewSnapshotInput } from "../types/terminal";

const createSnapshot = (
  overrides: Partial<TerminalViewSnapshotInput> = {},
): TerminalViewSnapshotInput => ({
  serializedContent: "terminal output",
  viewportY: 4,
  baseY: 10,
  rows: 24,
  cols: 80,
  isAtBottom: false,
  bufferType: "normal",
  capturedAt: 1,
  ...overrides,
});

describe("terminal store snapshots", () => {
  afterEach(() => {
    useTerminalStore.setState({ sessions: new Map() });
  });

  it("stores terminal view snapshots by session id", () => {
    const snapshot = useTerminalStore.getState().saveSessionSnapshot("session-a", createSnapshot());

    const session = useTerminalStore.getState().getSession("session-a");

    expect(session?.viewSnapshot).toEqual(snapshot);
    expect(session?.serializedContent).toBe("terminal output");
    expect(useTerminalStore.getState().getSessionSnapshot("session-a")).toEqual(snapshot);
  });

  it("clears snapshots without removing the live session metadata", () => {
    const store = useTerminalStore.getState();

    store.updateSession("session-a", { connectionId: "pty-a" });
    store.saveSessionSnapshot("session-a", createSnapshot());
    store.clearSessionSnapshot("session-a");

    expect(useTerminalStore.getState().getSession("session-a")).toEqual({
      connectionId: "pty-a",
      serializedContent: "terminal output",
    });
  });

  it("removes snapshots when a terminal session is removed", () => {
    const store = useTerminalStore.getState();

    store.saveSessionSnapshot("session-a", createSnapshot());
    store.removeSession("session-a");

    expect(useTerminalStore.getState().getSession("session-a")).toBeUndefined();
    expect(useTerminalStore.getState().getSessionSnapshot("session-a")).toBeUndefined();
  });

  it("does not let an older cleanup overwrite a newer snapshot", () => {
    const store = useTerminalStore.getState();
    const newerSnapshot = {
      ...createSnapshot({ serializedContent: "new output" }),
      version: Number.MAX_SAFE_INTEGER,
    };

    store.updateSession("session-a", {
      serializedContent: newerSnapshot.serializedContent,
      viewSnapshot: newerSnapshot,
    });
    store.saveSessionSnapshot("session-a", createSnapshot({ serializedContent: "old output" }));

    expect(useTerminalStore.getState().getSessionSnapshot("session-a")).toEqual(newerSnapshot);
    expect(useTerminalStore.getState().getSession("session-a")?.serializedContent).toBe(
      "new output",
    );
  });
});
