import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAgentWindowStore } from "@/features/ai/detached/agent-window.store";
import { restoreAgentDrafts } from "@/features/ai/detached/agent-window-drafts";
import { useAuthStore } from "@/features/window/stores/auth.store";
import { useGitHubStore } from "@/features/github/stores/github.store";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  focus: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
  once: vi.fn(),
  openAgent: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  settings: vi.fn(),
  state: {
    chats: [
      { id: "chat", title: "Agent", messages: [] },
      { id: "other", title: "Other agent", messages: [] },
    ],
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
vi.mock("@/features/window/stores/ui-state.store", () => ({
  useUIState: { getState: () => ({ openSettingsDialog: mocks.settings }) },
}));
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
  openAgentInNewWindow,
  captureAgentWindowSnapshot,
  restoreAgentWindowSnapshot,
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
let destroyListeners: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("BroadcastChannel", TestChannel);
  vi.clearAllMocks();
  mocks.create.mockResolvedValue("main-2");
  mocks.once.mockImplementation(async (event, listener) => {
    onDestroyed = listener;
    destroyListeners.push(listener);
    return () => {};
  });
  mocks.state = {
    chats: [
      { id: "chat", title: "Agent", messages: [] },
      { id: "other", title: "Other agent", messages: [] },
    ],
    currentChatId: null,
    selectedAgentId: "custom",
    chatMessageLoadStates: {},
    agentRuns: {},
    pendingAgentLaunchRequest: null,
    agentMessageQueues: {},
  };
  restoreAgentDrafts({});
  useAgentWindowStore.getState().actions.setAccountIdentity(null);
  useAuthStore.setState({ user: null });
  useGitHubStore.setState({ currentUser: null, githubAccountStatus: "unknown" });
});
afterEach(() => {
  destroyListeners.forEach((listener) => listener());
  destroyListeners = [];
  onDestroyed = undefined;
  useAgentWindowStore.getState().actions.setAccountIdentity(null);
  useAuthStore.setState({ user: null });
  useGitHubStore.setState({ currentUser: null, githubAccountStatus: "unknown" });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Agent session window ownership", () => {
  it("opens a dedicated agent route without changing folder-window preferences", async () => {
    await openAgentInNewWindow("chat");
    expect(mocks.create).toHaveBeenCalledWith({ agentWindow: expect.any(String) });
    expect(useAgentWindowStore.getState().sessions.chat).toBe("opening");
    TestChannel.current.receive({ type: "ready" });
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      snapshot: expect.objectContaining({ workspacePath: "/workspace" }),
    });
    TestChannel.current.receive({ type: "snapshot", snapshot: captureAgentWindowSnapshot("chat") });
    expect(useAgentWindowStore.getState().sessions.chat).toBe("detached");
  });

  it("focuses the existing window for the selected agent", async () => {
    await openAgentInNewWindow("chat");
    await openAgentInNewWindow("chat");
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({ type: "focus" });
  });

  it("restores local ownership when native creation fails", async () => {
    mocks.create.mockRejectedValueOnce(new Error("failed"));
    await openAgentInNewWindow("chat");
    expect(useAgentWindowStore.getState().sessions.chat).toBeUndefined();
    expect(TestChannel.current.close).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalled();
  });

  it("does not create a window while a run is active", async () => {
    mocks.state.agentRuns = { chat: { phase: "thinking" } };
    await openAgentInNewWindow("chat");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(useAgentWindowStore.getState().sessions.chat).toBeUndefined();
  });

  it("acknowledges returned state before releasing source ownership", async () => {
    await openAgentInNewWindow("chat");
    const snapshot = captureAgentWindowSnapshot("chat");
    snapshot.chat.currentChatId = "returned-chat";
    TestChannel.current.receive({ type: "return", snapshot });
    expect(mocks.state.currentChatId).toBeNull();
    expect(TestChannel.current.postMessage).toHaveBeenCalledWith({ type: "returned" });
    expect(useAgentWindowStore.getState().sessions.chat).toBe("detached");
    onDestroyed?.();
    onDestroyed = undefined;
    expect(useAgentWindowStore.getState().sessions.chat).toBeUndefined();
  });

  it("opens separate windows for different agents and releases ownership independently", async () => {
    await openAgentInNewWindow("chat");
    const first = TestChannel.current;
    await openAgentInNewWindow("other");
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(useAgentWindowStore.getState().sessions).toEqual({ chat: "opening", other: "opening" });
    destroyListeners[0]();
    expect(first.close).toHaveBeenCalledOnce();
    expect(useAgentWindowStore.getState().sessions).toEqual({ other: "opening" });
  });

  it("transfers only the selected agent even while another agent is running", async () => {
    mocks.state.agentRuns = { other: { phase: "thinking" } };
    await openAgentInNewWindow("chat");
    TestChannel.current.receive({ type: "ready" });
    const snapshot = TestChannel.current.postMessage.mock.calls[0][0].snapshot;
    expect(snapshot.chat.chats.map((chat: { id: string }) => chat.id)).toEqual(["chat"]);
    expect(snapshot.chat.currentChatId).toBe("chat");
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("transfers the owner's GitHub identity without waiting for detached sign-in", async () => {
    useGitHubStore.setState({ currentUser: "octocat", githubAccountStatus: "connected" });
    await openAgentInNewWindow("chat");
    TestChannel.current.receive({ type: "ready" });
    const snapshot = TestChannel.current.postMessage.mock.calls[0][0].snapshot;
    expect(snapshot.accountIdentity.name).toBe("octocat");
    expect(snapshot.accountIdentity.avatarUrl).toContain("octocat");
    restoreAgentWindowSnapshot(snapshot);
    expect(useAgentWindowStore.getState().accountIdentity).toEqual(snapshot.accountIdentity);
    useGitHubStore.setState({ currentUser: "updated-user" });
    expect(TestChannel.current.postMessage).toHaveBeenLastCalledWith({
      type: "identity",
      identity: expect.objectContaining({ name: "updated-user" }),
    });
  });

  it("opens the requested settings section in the owning workbench", async () => {
    await openAgentInNewWindow("chat");
    TestChannel.current.receive({ type: "settings", tab: "ai", section: "codex" });
    expect(mocks.settings).toHaveBeenCalledWith("ai", "codex");
    expect(mocks.focus).toHaveBeenCalled();
  });

  it("merges a returned session without overwriting other agents or the local selection", async () => {
    await openAgentInNewWindow("chat");
    const snapshot = captureAgentWindowSnapshot("chat");
    snapshot.chat.chats[0].title = "Updated in child";
    mocks.state.chats = [
      { id: "chat", title: "Agent", messages: [] },
      { id: "other", title: "Updated in parent", messages: [] },
      { id: "new", title: "Created in parent", messages: [] },
    ];
    mocks.state.currentChatId = "new";
    TestChannel.current.receive({ type: "return", snapshot });
    expect(mocks.state.chats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "chat", title: "Updated in child" }),
        expect.objectContaining({ id: "other", title: "Updated in parent" }),
        expect.objectContaining({ id: "new", title: "Created in parent" }),
      ]),
    );
    expect(mocks.state.currentChatId).toBe("new");
  });

  it("closes an uninitialized child before restoring the source", async () => {
    await openAgentInNewWindow("chat");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(useAgentWindowStore.getState().sessions.chat).toBeUndefined();
  });
});
