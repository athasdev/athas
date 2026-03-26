import { beforeEach, describe, expect, test } from "bun:test";
import { useSessionStore } from "./session-store";

describe("session-store", () => {
  beforeEach(() => {
    useSessionStore.getState().clearAllSessions();
    globalThis.localStorage?.removeItem("athas-tab-sessions");
  });

  test("persists mixed file and harness sessions", () => {
    useSessionStore.getState().saveSession(
      "/workspace/demo",
      [
        {
          kind: "file",
          path: "/workspace/demo/src/index.ts",
          name: "index.ts",
          isPinned: false,
        },
        {
          kind: "agent",
          sessionId: "session-123",
          name: "Harness Session",
          isPinned: true,
        },
      ],
      { kind: "agent", sessionId: "session-123" },
    );

    const session = useSessionStore.getState().getSession("/workspace/demo");

    expect(session).not.toBeNull();
    expect(session?.buffers).toHaveLength(2);
    expect(session?.buffers[1]).toEqual({
      kind: "agent",
      sessionId: "session-123",
      name: "Harness Session",
      isPinned: true,
    });
    expect(session?.activeBuffer).toEqual({ kind: "agent", sessionId: "session-123" });
    expect(session?.activeBufferPath).toBeNull();
  });

  test("keeps legacy activeBufferPath for file sessions", () => {
    useSessionStore.getState().saveSession(
      "/workspace/demo",
      [
        {
          kind: "file",
          path: "/workspace/demo/README.md",
          name: "README.md",
          isPinned: false,
        },
      ],
      { kind: "file", path: "/workspace/demo/README.md" },
    );

    const session = useSessionStore.getState().getSession("/workspace/demo");

    expect(session?.activeBuffer).toEqual({
      kind: "file",
      path: "/workspace/demo/README.md",
    });
    expect(session?.activeBufferPath).toBe("/workspace/demo/README.md");
  });
});
