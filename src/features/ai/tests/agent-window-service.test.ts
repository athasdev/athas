import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAgentWindowStore } from "@/features/ai/detached/agent-window.store";
import { restoreAgentDrafts } from "@/features/ai/detached/agent-window-drafts";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  focus: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  once: vi.fn(),
  openAgent: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  state: {
    chats: [],
    currentChatId: null,
    selectedAgentId: "custom",
    chatMessageLoadStates: {},
    agentRuns: {},
    pendingAgentLaunchRequest: null,
    agentMessageQueues: {},
  } as Record<string, unknown>,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setFocus: mocks.focus }),
  Window: class {
    once = mocks.once;
    destroy = mocks.destroy;
  },
}));
vi.mock("@/features/window/utils/create-app-window", () => ({ createAppWindow: mocks.create }));
vi.mock("sonner", () => ({ toast: { info: mocks.info, error: mocks.error } }));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => mocks.state,
    setState: (next: object) => {
      mocks.state = { ...mocks.state, ...next };
    },
  },
}));
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({
      buffers: [],
      activeBufferId: null,
      actions: { openAgentBuffer: mocks.openAgent },
    }),
  },
}));
vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: () => ({ rootFolderPath: "/workspace" }) },
}));

import {
  detachAgentView,
  captureAgentWindowSnapshot,
  type AgentWindowMessage,
} from "@/features/ai/detached/agent-window-service";

class TestChannel {
  static current: TestChannel;
  onmessage: ((event: { data: AgentWindowMessage }) => void) | null = null;
  postMessage = vi.fn();
  close = vi.fn();
  constructor() {
    TestChannel.current = this;
  }
  receive(data: AgentWindowMessage) {
    this.onmessage?.({ data });
  }
}
let onDestroyed: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", TestChannel);
  vi.clearAllMocks();
  mocks.create.mockResolvedValue("main-2");
  mocks.once.mockImplementation(async (event, listener) => {
    onDestroyed = listener;
    return () => {};
  });
  mocks.state = {
    chats: [],
    currentChatId: null,
    selectedAgentId: "custom",
    chatMessageLoadStates: {},
    agentRuns: {},
    pendingAgentLaunchRequest: null,
    agentMessageQueues: {},
  };
  restoreAgentDrafts({});
});
afterEach(() => {
  onDestroyed?.();
  onDestroyed = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Agents window ownership", () => {
  it("opens a dedicated Agents route without changing folder-window preferences", async () => {
    await detachAgentView();
    expect(mocks.create).toHaveBeenCalledWith({ agentWindow: expect.any(String) });
    expect(useAgentWindowStore.getState().status).toBe("opening");
    TestChannel.current.receive({ type: "ready" });
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      snapshot: expect.objectContaining({ workspacePath: "/workspace" }),
    });
    TestChannel.current.receive({ type: "snapshot", snapshot: captureAgentWindowSnapshot() });
    expect(useAgentWindowStore.getState().status).toBe("detached");
  });

  it("focuses the existing detached view instead of duplicating it", async () => {
    await detachAgentView();
    await detachAgentView();
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({ type: "focus" });
  });

  it("restores local ownership when native creation fails", async () => {
    mocks.create.mockRejectedValueOnce(new Error("failed"));
    await detachAgentView();
    expect(useAgentWindowStore.getState().status).toBe("attached");
    expect(TestChannel.current.close).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("does not create a window while a run is active", async () => {
    mocks.state.agentRuns = { chat: { phase: "thinking" } };
    await detachAgentView();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(useAgentWindowStore.getState().status).toBe("attached");
  });

  it("acknowledges returned state before releasing source ownership", async () => {
    await detachAgentView();
    const snapshot = captureAgentWindowSnapshot();
    snapshot.chat.currentChatId = "returned-chat";
    TestChannel.current.receive({ type: "return", snapshot });
    expect(mocks.state.currentChatId).toBe("returned-chat");
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({ type: "returned" });
    expect(useAgentWindowStore.getState().status).toBe("detached");
    onDestroyed?.();
    onDestroyed = undefined;
    expect(useAgentWindowStore.getState().status).toBe("attached");
  });

  it("closes an uninitialized child before restoring the source", async () => {
    await detachAgentView();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(useAgentWindowStore.getState().status).toBe("attached");
  });
});
