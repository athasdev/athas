// @vitest-environment jsdom
import { enableMapSet } from "immer";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAuthStore } from "@/features/auth/stores/auth.store";
import { publishEditorScroll } from "@/features/editor/services/editor-scroll-events";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useCollaborationPresence } from "../hooks/use-collaboration-presence";
import {
  getCollaborationClientId,
  type CollaborationDocumentSnapshot,
  type CollaborationDocumentUpdate,
} from "../services/collaboration-api";
import type { CollaborationRoomClientMessage } from "../services/collaboration-realtime";
import { useCollaborationRuntimeStore } from "../stores/collaboration-runtime.store";

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: () => Promise.resolve(null),
      transformCallback: () => 1,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

type StreamEvent =
  | {
      type: "ready";
      document: CollaborationDocumentSnapshot;
      afterServerVersion: number;
      pollIntervalMs: number;
    }
  | { type: "update"; document: CollaborationDocumentSnapshot; update: CollaborationDocumentUpdate }
  | { type: "heartbeat"; document: CollaborationDocumentSnapshot; afterServerVersion: number }
  | { type: "error"; error: string };

interface StreamRequest {
  documentId: number;
  afterVersion?: number;
  signal?: AbortSignal;
  onEvent: (event: StreamEvent) => void;
}

const net = vi.hoisted(() => ({
  presence: [] as Array<Record<string, unknown>>,
  register: vi.fn(),
  append: vi.fn(),
  streams: [] as Array<{
    documentId: number;
    afterVersion?: number;
    signal?: AbortSignal;
    onEvent: (event: unknown) => void;
    end: () => void;
  }>,
  rooms: [] as Array<{
    target: unknown;
    open: boolean;
    closed: boolean;
    sent: unknown[];
    onMessage: (message: unknown) => void;
  }>,
}));

vi.mock("../services/collaboration-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/collaboration-api")>()),
  updateCollaborationPresence: async (input: Record<string, unknown>) => {
    net.presence.push(input);
    return null;
  },
  registerCollaborationDocument: net.register,
  appendCollaborationDocumentUpdate: net.append,
  streamCollaborationDocumentUpdates: (request: StreamRequest) =>
    new Promise<void>((resolve, reject) => {
      net.streams.push({ ...request, onEvent: request.onEvent as never, end: resolve });
      request.signal?.addEventListener("abort", () => reject(request.signal?.reason));
    }),
}));
vi.mock("../services/collaboration-realtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/collaboration-realtime")>()),
  connectCollaborationRoom: (options: {
    target: unknown;
    onMessage: (message: unknown) => void;
  }) => {
    const room = {
      target: options.target,
      open: false,
      closed: false,
      sent: [] as unknown[],
      onMessage: options.onMessage,
      isOpen: () => room.open,
      send: (message: unknown) => {
        room.sent.push(message);
        return true;
      },
      close: () => {
        room.closed = true;
      },
    };
    net.rooms.push(room);
    return room;
  },
}));

enableMapSet();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const document7: CollaborationDocumentSnapshot = {
  id: 7,
  path: "/repo/app.ts",
  baseVersion: 3,
  stateVector: {},
  updatedAt: null,
};

let root: Root | undefined;

function collaboration(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    settings: { sharedSettings: { presenceEnabled: true } },
    capabilities: { realtimeDocuments: true },
    documents: [document7],
    ...overrides,
  };
}

function signIn(snapshot: Record<string, unknown> = collaboration()) {
  useAuthStore.setState({
    isAuthenticated: true,
    subscription: { collaboration: snapshot } as never,
  });
}

function openFile(path: string) {
  act(() => {
    useBufferStore.getState().actions.openContent({
      type: "editor",
      path,
      name: path.slice(path.lastIndexOf("/") + 1),
      content: "",
    });
  });
}

async function mount() {
  function Harness() {
    useCollaborationPresence();
    return null;
  }
  root = createRoot(document.createElement("div"));
  await act(async () => root!.render(createElement(Harness)));
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const stream = () => useCollaborationRuntimeStore.getState().activeDocumentStream;
const runtime = () => useCollaborationRuntimeStore.getState();

function remoteUpdate(
  overrides: Partial<CollaborationDocumentUpdate> = {},
): CollaborationDocumentUpdate {
  return {
    id: 1,
    documentId: 7,
    actorUserId: 2,
    clientId: "remote-device",
    clientSeq: 1,
    serverVersion: 5,
    updateType: "cursor",
    operation: { path: "/repo/app.ts", cursor: { line: 2, column: 4, offset: 20 } },
    createdAt: null,
    ...overrides,
  };
}

async function goLive() {
  net.register.mockResolvedValue(collaboration());
  openFile("/repo/app.ts");
  await mount();
  await flush();
  await act(async () => {
    net.streams[0].onEvent({
      type: "ready",
      document: document7,
      afterServerVersion: 3,
      pollIntervalMs: 2000,
    });
  });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  workspaceRuntimeRegistry.resetForTests();
  net.presence = [];
  net.streams = [];
  net.rooms = [];
  net.register.mockReset();
  net.append.mockReset().mockResolvedValue(null);
  useAuthStore.setState({ isAuthenticated: false, subscription: null });
  useCollaborationRuntimeStore.setState({
    presenceTarget: { channelId: null, followingUserId: null },
    mediaState: { microphone: false, screen: false },
  });
  act(() => runtime().actions.resetStream());
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  vi.useRealTimers();
});

describe("collaboration presence", () => {
  it("announces the open file, repeats it as a heartbeat, and goes offline on unmount", async () => {
    signIn(collaboration({ capabilities: { realtimeDocuments: false } }));
    act(() => {
      runtime().actions.setPresenceChannel(4);
      runtime().actions.setMicrophoneActive(true);
      runtime().actions.setScreenShareActive(true);
    });
    openFile("/repo/app.ts");
    await mount();

    expect(net.presence).toEqual([
      {
        status: "online",
        activeFilePath: "/repo/app.ts",
        channelId: 4,
        followingUserId: null,
        cursorLabel: "mic,screen",
      },
    ]);

    await flush(60_000);
    expect(net.presence).toHaveLength(2);

    act(() => root!.unmount());
    root = undefined;
    expect(net.presence[net.presence.length - 1]).toEqual({
      status: "offline",
      activeFilePath: "/repo/app.ts",
      channelId: null,
      followingUserId: null,
      cursorLabel: null,
    });
    expect(net.streams).toEqual([]);
  });

  it("does not share untitled or virtual files and respects disabled presence", async () => {
    signIn(collaboration({ capabilities: { realtimeDocuments: false } }));
    openFile("untitled:Untitled-1");
    await mount();
    expect(net.presence[0].activeFilePath).toBeNull();

    act(() => root!.unmount());
    root = undefined;
    net.presence = [];
    signIn(
      collaboration({
        settings: { sharedSettings: { presenceEnabled: false } },
        capabilities: { realtimeDocuments: false },
      }),
    );
    await mount();
    expect(net.presence).toEqual([]);
  });

  it("stays silent while signed out", async () => {
    openFile("/repo/app.ts");
    await mount();

    expect(net.presence).toEqual([]);
    expect(net.register).not.toHaveBeenCalled();
    expect(stream().status).toBe("idle");
  });
});

describe("collaboration document stream", () => {
  it("registers the active file and goes live on the stream's ready event", async () => {
    signIn();
    await goLive();

    expect(net.register).toHaveBeenCalledWith({
      path: "/repo/app.ts",
      baseVersion: 0,
      stateVector: { source: "desktop-active-buffer" },
    });
    expect(net.streams[0]).toMatchObject({ documentId: 7, afterVersion: 3 });
    expect(stream()).toMatchObject({ status: "live", documentId: 7, path: "/repo/app.ts" });
  });

  it("tracks remote cursors from document updates but ignores its own", async () => {
    signIn();
    await goLive();

    await act(async () => {
      net.streams[0].onEvent({ type: "update", document: document7, update: remoteUpdate() });
      net.streams[0].onEvent({
        type: "update",
        document: document7,
        update: remoteUpdate({ clientId: getCollaborationClientId(), serverVersion: 6 }),
      });
      net.streams[0].onEvent({ type: "heartbeat", document: document7, afterServerVersion: 9 });
    });

    expect(runtime().remoteCursors.map((cursor) => [cursor.clientId, cursor.line])).toEqual([
      ["remote-device", 2],
    ]);
    expect(stream()).toMatchObject({ updatesReceived: 2, lastServerVersion: 9 });
  });

  it("reconnects after the stream ends, resuming after the newest version", async () => {
    signIn();
    await goLive();
    await act(async () => {
      net.streams[0].onEvent({
        type: "update",
        document: document7,
        update: remoteUpdate({ serverVersion: 12 }),
      });
      net.streams[0].end();
    });
    await flush();
    expect(stream().status).toBe("reconnecting");

    await flush(2_000);

    expect(net.streams).toHaveLength(2);
    expect(net.streams[1].afterVersion).toBe(12);
  });

  it("shows stream errors reported by the server", async () => {
    signIn();
    await goLive();

    await act(async () => {
      net.streams[0].onEvent({ type: "error", error: "Document was deleted" });
    });

    expect(stream()).toMatchObject({ status: "error", error: "Document was deleted" });
  });

  it("explains registration results it cannot use", async () => {
    signIn();
    net.register.mockResolvedValueOnce(null);
    openFile("/repo/app.ts");
    await mount();
    await flush();
    expect(stream().error).toBe(
      "Collaboration document registration did not return a workspace snapshot.",
    );

    act(() => root!.unmount());
    net.register.mockResolvedValueOnce(collaboration({ documents: [] }));
    await mount();
    await flush();
    expect(stream().error).toBe(
      "Registered collaboration document was not returned by the account service.",
    );

    act(() => root!.unmount());
    net.register.mockRejectedValueOnce(new Error("offline"));
    await mount();
    await flush();
    expect(stream()).toMatchObject({
      status: "error",
      error: "Collaboration document stream failed.",
    });
  });

  it("stops streaming and resets when the hook unmounts", async () => {
    signIn();
    await goLive();

    act(() => root!.unmount());
    root = undefined;
    await flush();

    expect(net.streams[0].signal?.aborted).toBe(true);
    expect(stream().status).toBe("idle");
    expect(net.rooms[0].closed).toBe(true);
  });
});

describe("collaboration document room", () => {
  it("records presence relayed through the room and drops members that leave", async () => {
    signIn();
    await goLive();
    const room = net.rooms[0];
    expect(room.target).toEqual({ documentId: 7 });

    await act(async () => {
      room.onMessage({
        type: "presence",
        from: { connectionId: "c", userId: 2, deviceId: "laptop" },
        data: {
          updateType: "metadata",
          operation: {
            source: "desktop-viewport",
            path: "/repo/app.ts",
            viewport: { scrollTop: 100, scrollLeft: 0, viewportHeight: 600 },
          },
        },
      });
      room.onMessage({
        type: "presence",
        from: { connectionId: "d", userId: 3 },
        data: { updateType: "cursor", operation: {} },
      });
    });
    expect(
      runtime().remoteViewports.map((viewport) => [viewport.clientId, viewport.scrollTop]),
    ).toEqual([["laptop", 100]]);

    await act(async () => {
      room.onMessage({
        type: "leave",
        member: { connectionId: "c", userId: 2, deviceId: "laptop" },
      });
    });
    expect(runtime().remoteViewports).toEqual([]);
  });

  it("publishes throttled cursor moves through the open room", async () => {
    signIn();
    await goLive();
    const room = net.rooms[0];
    room.open = true;
    await flush(2_000);
    room.sent = [];

    act(() => {
      useEditorStateStore.getState().actions.setCursorPosition({ line: 1, column: 1, offset: 5 });
    });
    act(() => {
      useEditorStateStore.getState().actions.setCursorPosition({ line: 3, column: 0, offset: 30 });
    });
    await flush(1_499);
    expect(room.sent).toEqual([]);
    await flush(1);

    expect(room.sent).toEqual([
      {
        type: "presence",
        data: {
          updateType: "cursor",
          operation: expect.objectContaining({
            source: "desktop-cursor",
            path: "/repo/app.ts",
            cursor: { line: 3, column: 0, offset: 30 },
          }),
        },
      },
    ]);
    expect(stream().cursorUpdatesSent).toBeGreaterThanOrEqual(2);
    expect(net.append).not.toHaveBeenCalled();
  });

  it("falls back to the account service when the room is not open", async () => {
    signIn();
    await goLive();
    await flush(2_000);

    expect(net.append).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 7, updateType: "cursor" }),
    );
    expect(net.append).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 7,
        updateType: "metadata",
        operation: expect.objectContaining({ source: "desktop-viewport" }),
      }),
    );
    expect(stream()).toMatchObject({ cursorUpdatesSent: 1, viewportUpdatesSent: 1 });
  });

  it("publishes viewport changes after scrolling settles", async () => {
    signIn();
    await goLive();
    const room = net.rooms[0];
    room.open = true;
    await flush(2_000);
    room.sent = [];

    act(() => {
      useEditorStateStore.getState().actions.setScroll(240, 8);
      publishEditorScroll();
    });
    await flush(2_000);

    const viewportMessages = (room.sent as CollaborationRoomClientMessage[]).filter(
      (message) =>
        message.type === "presence" &&
        (message.data.operation as { source?: string }).source === "desktop-viewport",
    );
    expect(viewportMessages).toHaveLength(1);
  });
});
