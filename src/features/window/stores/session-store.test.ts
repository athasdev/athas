import { beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_HARNESS_SESSION_KEY } from "@/features/ai/lib/chat-scope";
import { DEFAULT_HARNESS_RUNTIME_BACKEND } from "@/features/ai/lib/harness-runtime-backend";
import {
  getPersistedProjectSession,
  getPersistedProjectSessionWithRetry,
  useSessionStore,
} from "./session-store";

const createMemoryStorage = () => {
  const storage = new Map<string, string>();
  return {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
  };
};

describe("session-store", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
    });
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
          backend: "pi-native",
          name: "Harness Session",
          isPinned: true,
        },
      ],
      { kind: "agent", sessionId: "session-123", backend: "pi-native" },
    );

    const session = useSessionStore.getState().getSession("/workspace/demo");

    expect(session).not.toBeNull();
    expect(session?.buffers).toHaveLength(2);
    expect(session?.buffers[1]).toEqual({
      kind: "agent",
      sessionId: "session-123",
      backend: "pi-native",
      name: "Harness Session",
      isPinned: true,
    });
    expect(session?.activeBuffer).toEqual({
      kind: "agent",
      sessionId: "session-123",
      backend: "pi-native",
    });
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

  test("reads a persisted wrapped session payload directly from localStorage", () => {
    globalThis.localStorage?.setItem(
      "athas-tab-sessions",
      JSON.stringify({
        state: {
          sessions: {
            "/workspace/demo": {
              projectPath: "/workspace/demo",
              activeBuffer: {
                kind: "agent",
                sessionId: "harness",
                backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
              },
              activeBufferPath: null,
              buffers: [
                {
                  kind: "agent",
                  sessionId: "harness",
                  backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
                  name: "Harness",
                  isPinned: false,
                },
              ],
              terminals: [],
              lastSaved: 123,
            },
          },
        },
        version: 2,
      }),
    );

    expect(getPersistedProjectSession("/workspace/demo")).toMatchObject({
      projectPath: "/workspace/demo",
      activeBuffer: {
        kind: "agent",
        sessionId: "harness",
        backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      },
      buffers: [
        {
          kind: "agent",
          sessionId: "harness",
          backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
          name: "Harness",
          isPinned: false,
        },
      ],
    });
  });

  test("normalizes legacy file-shaped Harness buffers from hydrated session state", () => {
    useSessionStore.setState({
      sessions: {
        "/workspace/demo": {
          projectPath: "/workspace/demo",
          activeBuffer: { kind: "file", path: "agent://harness" },
          activeBufferPath: "agent://harness",
          buffers: [
            {
              path: "agent://harness",
              name: "harness",
              isPinned: false,
            },
          ],
          terminals: [],
          lastSaved: 123,
        },
      },
    });

    expect(useSessionStore.getState().getSession("/workspace/demo")).toEqual({
      projectPath: "/workspace/demo",
      activeBuffer: {
        kind: "agent",
        sessionId: DEFAULT_HARNESS_SESSION_KEY,
        backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      },
      activeBufferPath: null,
      buffers: [
        {
          kind: "agent",
          sessionId: DEFAULT_HARNESS_SESSION_KEY,
          backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
          name: "harness",
          isPinned: false,
        },
      ],
      terminals: [],
      lastSaved: 123,
    });
  });

  test("normalizes persisted legacy agent:// Harness entries from localStorage", () => {
    globalThis.localStorage?.setItem(
      "athas-tab-sessions",
      JSON.stringify({
        state: {
          sessions: {
            "/workspace/demo": {
              projectPath: "/workspace/demo",
              activeBuffer: { kind: "file", path: "agent://harness" },
              activeBufferPath: "agent://harness",
              buffers: [
                {
                  path: "agent://harness",
                  name: "harness",
                  isPinned: false,
                },
              ],
              terminals: [],
              lastSaved: 123,
            },
          },
        },
        version: 2,
      }),
    );

    expect(getPersistedProjectSession("/workspace/demo")).toEqual({
      projectPath: "/workspace/demo",
      activeBuffer: {
        kind: "agent",
        sessionId: DEFAULT_HARNESS_SESSION_KEY,
        backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      },
      activeBufferPath: null,
      buffers: [
        {
          kind: "agent",
          sessionId: DEFAULT_HARNESS_SESSION_KEY,
          backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
          name: "harness",
          isPinned: false,
        },
      ],
      terminals: [],
      lastSaved: 123,
    });
  });

  test("waits briefly for a persisted session to become readable", async () => {
    setTimeout(() => {
      globalThis.localStorage?.setItem(
        "athas-tab-sessions",
        JSON.stringify({
          state: {
            sessions: {
              "/workspace/demo": {
                projectPath: "/workspace/demo",
                activeBuffer: {
                  kind: "agent",
                  sessionId: "harness",
                  backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
                },
                activeBufferPath: null,
                buffers: [
                  {
                    kind: "agent",
                    sessionId: "harness",
                    backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
                    name: "Harness",
                    isPinned: false,
                  },
                ],
                terminals: [],
                lastSaved: 123,
              },
            },
          },
          version: 2,
        }),
      );
    }, 10);

    await expect(
      getPersistedProjectSessionWithRetry("/workspace/demo", { attempts: 5, delayMs: 10 }),
    ).resolves.toMatchObject({
      projectPath: "/workspace/demo",
      activeBuffer: {
        kind: "agent",
        sessionId: "harness",
        backend: DEFAULT_HARNESS_RUNTIME_BACKEND,
      },
    });
  });

  test("normalizes backend-aware agent paths from persisted localStorage", () => {
    globalThis.localStorage?.setItem(
      "athas-tab-sessions",
      JSON.stringify({
        state: {
          sessions: {
            "/workspace/demo": {
              projectPath: "/workspace/demo",
              activeBuffer: { kind: "file", path: "agent://pi-native/session-123" },
              activeBufferPath: "agent://pi-native/session-123",
              buffers: [
                {
                  path: "agent://pi-native/session-123",
                  name: "Pi Native",
                  isPinned: true,
                },
              ],
              terminals: [],
              lastSaved: 123,
            },
          },
        },
        version: 2,
      }),
    );

    expect(getPersistedProjectSession("/workspace/demo")).toEqual({
      projectPath: "/workspace/demo",
      activeBuffer: {
        kind: "agent",
        sessionId: "session-123",
        backend: "pi-native",
      },
      activeBufferPath: null,
      buffers: [
        {
          kind: "agent",
          sessionId: "session-123",
          backend: "pi-native",
          name: "Pi Native",
          isPinned: true,
        },
      ],
      terminals: [],
      lastSaved: 123,
    });
  });
});
