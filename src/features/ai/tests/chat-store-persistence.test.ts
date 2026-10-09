import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const db = vi.hoisted(() => ({
  deleteChatFromDb: vi.fn(),
  forgetSavedChatMessages: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn(),
  saveChatToDb: vi.fn(),
}));
const buffers = vi.hoisted(() => ({ list: [] as unknown[], updateBuffer: vi.fn() }));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => db);
vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ buffers: buffers.list, actions: { updateBuffer: buffers.updateBuffer } }),
  },
}));

import { enableMapSet } from "immer";
import { commands } from "@/bindings/commands";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { useAIChatStore } from "../stores/ai-chat.store";
import { createInitialAIChatState } from "../stores/ai-chat/ai-chat-state";
import type { Chat, ChatSession, Message } from "../types/ai-chat.types";

enableMapSet();

const actions = () => useAIChatStore.getState().actions;
const state = () => useAIChatStore.getState();

function message(id: string, role: "user" | "assistant", content: string): Message {
  return { id, role, content, timestamp: new Date(1_000) };
}

function session(id: string, overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id,
    title: `Chat ${id}`,
    createdAt: new Date(0),
    lastMessageAt: new Date(0),
    agentId: "custom",
    acpSessionId: null,
    providerId: "athas",
    modelId: "auto",
    isPinned: false,
    archivedAt: null,
    workspacePath: null,
    messageCount: 0,
    ...overrides,
  } as ChatSession;
}

function storedChat(id: string, messages: Message[]): Chat {
  return { ...session(id), messages } as Chat;
}

function withChat(chat: ChatSession, messages?: Message[], loaded = Boolean(messages)) {
  useAIChatStore.setState((draft) => {
    draft.chats.push(chat);
    if (messages) draft.messagesByChat[chat.id] = messages;
    if (loaded) draft.chatMessageLoadStates[chat.id] = "loaded";
  });
}

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  for (const fn of Object.values(db)) fn.mockResolvedValue(undefined);
  db.loadAllChatsFromDb.mockResolvedValue([]);
  buffers.list = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
  useProjectStore.setState({ rootFolderPath: undefined });
  useAIChatStore.setState({
    ...createInitialAIChatState(),
    actions: state().actions,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("loading chat messages", () => {
  it("merges stored messages with ones that arrived while loading", async () => {
    withChat(
      session("c1", { messageCount: 2 }),
      [message("live", "user", "Typed meanwhile")],
      false,
    );
    db.loadChatFromDb.mockResolvedValue(
      storedChat("c1", [message("m1", "user", "Old"), message("m2", "assistant", "Reply")]),
    );

    await actions().loadChatMessages("c1");

    expect(state().chatMessageLoadStates.c1).toBe("loaded");
    expect(state().messagesByChat.c1.map((m) => m.id)).toEqual(["m1", "m2", "live"]);
    expect(state().chats[0].messageCount).toBe(3);
  });

  it("shares one database read between concurrent loads", async () => {
    withChat(session("c1"));
    db.loadChatFromDb.mockResolvedValue(storedChat("c1", []));
    await Promise.all([actions().loadChatMessages("c1"), actions().loadChatMessages("c1")]);
    expect(db.loadChatFromDb).toHaveBeenCalledTimes(1);
  });

  it("keeps live messages and saves them when they changed during the load", async () => {
    withChat(session("c1"), [message("a", "user", "First")], false);
    db.loadChatFromDb.mockImplementation(async () => {
      actions().addMessage("c1", message("b", "assistant", "Second"));
      return storedChat("c1", [message("x", "user", "Stale")]);
    });

    await actions().loadChatMessages("c1");

    expect(state().messagesByChat.c1.map((m) => m.id)).toEqual(["a", "b"]);
    expect(db.saveChatToDb).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", messages: expect.arrayContaining([expect.anything()]) }),
    );
  });

  it("drops the load state when the chat left the list mid-fetch", async () => {
    withChat(session("c1"));
    db.loadChatFromDb.mockImplementation(async () => {
      useAIChatStore.setState({ chats: [] });
      return storedChat("c1", []);
    });

    await actions().loadChatMessages("c1");

    expect(state().chatMessageLoadStates.c1).toBeUndefined();
  });

  it("forgets a chat that has no stored rows and no messages", async () => {
    withChat(session("c1"), undefined, false);
    useAIChatStore.setState({ currentChatId: "c1" });
    db.loadChatFromDb.mockRejectedValue(new Error("Query returned no rows"));

    await actions().loadChatMessages("c1");

    expect(state().chats).toEqual([]);
    expect(state().currentChatId).toBeNull();
    expect(state().chatMessageLoadStates.c1).toBeUndefined();
  });

  it("writes in-memory messages for a chat the database never stored", async () => {
    withChat(session("c1"), [message("a", "user", "Hello")], false);
    db.loadChatFromDb.mockRejectedValue("Query returned no rows");

    await actions().loadChatMessages("c1");

    expect(state().chatMessageLoadStates.c1).toBe("loaded");
    expect(db.forgetSavedChatMessages).toHaveBeenCalledWith("c1");
    expect(db.saveChatToDb).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("marks a failed load so the view can offer a retry", async () => {
    withChat(session("c1"));
    db.loadChatFromDb.mockRejectedValue(new Error("database is locked"));

    await actions().loadChatMessages("c1");

    expect(state().chatMessageLoadStates.c1).toBe("error");
  });

  it("loads messages for chats surfaced by switching or restoring", async () => {
    withChat(session("c1"));
    withChat(session("c2"));
    db.loadChatFromDb.mockImplementation(async (id: string) => storedChat(id, []));

    actions().switchToChat("c1");
    actions().restoreWorkspaceSession({ currentChatId: "c2", selectedAgentId: "claude-code" });
    await flushAsync();

    expect(db.loadChatFromDb.mock.calls.map(([id]) => id)).toEqual(["c1", "c2"]);
    expect(actions().getWorkspaceSessionSnapshot()).toEqual({
      currentChatId: "c2",
      selectedAgentId: "claude-code",
    });

    actions().restoreWorkspaceSession(null);
    expect(actions().getWorkspaceSessionSnapshot()).toEqual({
      currentChatId: null,
      selectedAgentId: "custom",
    });
  });
});

describe("saving chats", () => {
  it("saves only the row of a chat whose messages were never loaded", async () => {
    withChat(session("c1"));
    actions().setChatAcpSessionId("c1", "acp-1");
    await flushAsync();

    expect(db.saveChatMetadataToDb).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1", acpSessionId: "acp-1" }),
    );
    expect(db.saveChatToDb).not.toHaveBeenCalled();
  });

  it("does not save while the chat is still loading and survives save failures", async () => {
    withChat(session("c1"));
    useAIChatStore.setState((draft) => {
      draft.chatMessageLoadStates.c1 = "loading";
    });
    actions().setChatAcpSessionId("c1", "x");
    await flushAsync();
    expect(db.saveChatMetadataToDb).not.toHaveBeenCalled();

    useAIChatStore.setState((draft) => {
      draft.chatMessageLoadStates.c1 = "loaded";
      draft.messagesByChat.c1 = [];
    });
    db.saveChatToDb.mockRejectedValueOnce(new Error("disk full"));
    actions().setChatAcpSessionId("c1", "y");
    await flushAsync();
    expect(console.error).toHaveBeenCalledWith(
      "Failed to sync chat c1 to database:",
      expect.any(Error),
    );
  });

  it("batches streamed message updates into one delayed save", async () => {
    vi.useFakeTimers();
    withChat(session("c1"), [message("a", "assistant", "")]);

    actions().updateMessage("c1", "a", { content: "He", isStreaming: true });
    actions().updateMessage("c1", "a", { content: "Hello", isStreaming: true });
    expect(db.saveChatToDb).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);

    expect(db.saveChatToDb).toHaveBeenCalledTimes(1);
    expect(db.saveChatToDb.mock.calls[0][0].messages[0].content).toBe("Hello");
  });

  it("applies queued chunks before later writes, in order", () => {
    withChat(session("c1"), [message("a", "assistant", "")]);

    actions().appendMessageContent("c1", "a", "Hel");
    actions().appendMessageContent("c1", "a", "");
    actions().appendMessageContent("c1", "a", "lo");
    actions().queueMessageUpdate("c1", "a", { isStreaming: true });
    actions().updateMessage("c1", "a", { isStreaming: false });

    expect(state().messagesByChat.c1[0]).toMatchObject({ content: "Hello", isStreaming: false });
  });

  it("lands queued updates on the next frame", async () => {
    vi.useFakeTimers();
    withChat(session("c1"), [message("a", "assistant", "")]);

    actions().queueMessageUpdate("c1", "a", { content: "Draft" });
    actions().appendMessageContent("c1", "a", " more");
    expect(state().messagesByChat.c1[0].content).toBe("");
    await vi.advanceTimersByTimeAsync(16);

    expect(state().messagesByChat.c1[0].content).toBe("Draft more");
  });

  it("replaces a chat's messages and dates it by the last one", async () => {
    withChat(session("c1"), []);
    actions().replaceChatMessages("c1", [
      message("u", "user", "Q"),
      { ...message("a", "assistant", "A"), timestamp: new Date(5_000) },
    ]);
    expect(state().chats[0].messageCount).toBe(2);
    expect(state().chats[0].lastMessageAt).toEqual(new Date(5_000));

    actions().replaceChatMessages("c1", []);
    expect(state().chats[0].lastMessageAt).toEqual(new Date(0));
  });

  it("rewrites an edited user message and drops what followed", () => {
    withChat(session("c1"), [
      message("u1", "user", "Old"),
      message("a1", "assistant", "Answer"),
      message("u2", "user", "Next"),
    ]);

    expect(actions().replaceUserMessage("c1", "u1", "   ")).toBe(false);
    expect(actions().replaceUserMessage("c1", "a1", "Not a prompt")).toBe(false);
    expect(actions().replaceUserMessage("c1", "u1", " New ")).toBe(true);

    expect(state().messagesByChat.c1.map((m) => m.content)).toEqual(["New"]);
    expect(state().chats[0].messageCount).toBe(1);
  });
});

describe("chat list actions", () => {
  it("renames the chat and its open agent tab", async () => {
    withChat(session("c1"), []);
    buffers.list = [
      { id: "b1", type: "agent", sessionId: "c1", name: "Old" },
      { id: "b2", type: "agent", sessionId: "c2", name: "Other" },
    ];

    actions().updateChatTitle("c1", "Fix login");
    await flushAsync();

    expect(state().chats[0].title).toBe("Fix login");
    expect(buffers.updateBuffer).toHaveBeenCalledWith(
      expect.objectContaining({ id: "b1", name: "Fix login" }),
    );
    expect(buffers.updateBuffer).toHaveBeenCalledTimes(1);
  });

  it("pins, archives and moves to the next session", () => {
    withChat(session("c1", { messageCount: 1, lastMessageAt: new Date(10) }), []);
    withChat(session("c2", { messageCount: 1, lastMessageAt: new Date(20) }), []);
    useAIChatStore.setState({ currentChatId: "c1" });

    actions().setChatPinned("c1", true);
    expect(state().chats[0].isPinned).toBe(true);

    actions().setChatArchived("c1", true);
    expect(state().chats[0]).toMatchObject({ isPinned: false, archivedAt: expect.any(Date) });
    expect(state().currentChatId).toBe("c2");

    actions().setChatArchived("c1", false);
    expect(state().chats[0].archivedAt).toBeNull();
    expect(db.saveChatMetadataToDb).toHaveBeenCalledTimes(3);
  });

  it("changes the model of built-in agent chats only", () => {
    withChat(session("c1"), []);
    withChat(session("c2", { agentId: "claude-code", providerId: null, modelId: null }), []);

    actions().setChatModel("c1", "openai", "gpt-5.6-sol");
    actions().setChatModel("c2", "openai", "gpt-5.6-sol");

    expect(state().chats[0]).toMatchObject({ providerId: "openai", modelId: "gpt-5.6-sol" });
    expect(state().chats[1]).toMatchObject({ providerId: null, modelId: null });
    expect(db.saveChatMetadataToDb).toHaveBeenCalledTimes(1);
  });

  it("deletes a chat, closes its agent session and opens the next one", async () => {
    const closeSession = vi
      .spyOn(commands, "closeAcpSession")
      .mockResolvedValue(undefined as never);
    withChat(session("c1", { agentId: "claude-code", acpSessionId: "s1" }), []);
    withChat(session("c2", { messageCount: 1 }), undefined, false);
    useAIChatStore.setState((draft) => {
      draft.currentChatId = "c1";
      draft.acpSessions.s1 = {} as never;
      draft.agentRuns.c1 = { runId: "r" } as never;
    });
    db.loadChatFromDb.mockResolvedValue(storedChat("c2", []));

    actions().deleteChat("c1");
    await flushAsync();
    await flushAsync();

    expect(state().chats.map((chat) => chat.id)).toEqual(["c2"]);
    expect(state().currentChatId).toBe("c2");
    expect(state().agentRuns.c1).toBeUndefined();
    expect(state().acpSessions.s1).toBeUndefined();
    expect(db.deleteChatFromDb).toHaveBeenCalledWith("c1");
    expect(db.loadChatFromDb).toHaveBeenCalledWith("c2");
    expect(closeSession).toHaveBeenCalledWith("s1");
  });

  it("reuses an untouched chat for a new agent session", () => {
    withChat(session("old", { agentId: "claude-code" }), []);
    expect(actions().createNewChat("claude-code", { reuseEmpty: true })).toBe("old");
    expect(state().currentChatId).toBe("old");

    const fresh = actions().createNewChat("codex", { reuseEmpty: true, activate: false });
    expect(fresh).not.toBe("old");
    expect(state().currentChatId).toBe("old");
  });

  it("finds a chat for an agent in the current workspace", () => {
    useProjectStore.setState({ rootFolderPath: "/work" });
    withChat(session("elsewhere", { workspacePath: "/other" }), []);
    withChat(
      session("archived", {
        agentId: "claude-code",
        workspacePath: "/work",
        archivedAt: new Date(),
      }),
      [],
    );
    withChat(session("any", { agentId: "custom", workspacePath: "/work" }), []);

    expect(actions().ensureChatForAgent("claude-code")).toBe("any");
    expect(actions().ensureChatForAgent("claude-code")).toBe("any");

    withChat(session("match", { agentId: "codex", workspacePath: "/work" }), []);
    useAIChatStore.setState({ currentChatId: "elsewhere" });
    expect(actions().ensureChatForAgent("codex")).toBe("match");

    useAIChatStore.setState({ currentChatId: null, chats: [] });
    const created = actions().ensureChatForAgent("codex");
    expect(state().chats[0]).toMatchObject({
      id: created,
      agentId: "codex",
      workspacePath: "/work",
    });
  });

  it("switches an untouched chat's agent in place and starts a new chat otherwise", async () => {
    expect(actions().selectChatAgent(null, "claude-code")).toBeNull();
    expect(state().selectedAgentId).toBe("claude-code");

    withChat(session("empty"), []);
    expect(actions().selectChatAgent("empty", "codex")).toBe("empty");
    expect(state().chats[0]).toMatchObject({ agentId: "codex", providerId: null, modelId: null });
    expect(state().selectedAgentId).toBe("codex");

    useAIChatStore.setState({ currentChatId: "empty" });
    actions().changeCurrentChatAgent("custom");
    expect(state().chats[0].agentId).toBe("custom");

    expect(
      actions().selectChatAgent("empty", "custom", {
        model: { providerId: "openai", modelId: "gpt-5.6-sol" },
      }),
    ).toBe("empty");
    expect(state().chats[0]).toMatchObject({ providerId: "openai", modelId: "gpt-5.6-sol" });

    withChat(session("busy", { agentId: "claude-code", messageCount: 2 }), [
      message("u", "user", "Hi"),
    ]);
    const next = actions().selectChatAgent("busy", "custom", {
      model: { providerId: "mistral", modelId: "mistral-medium-3-5" },
    });
    expect(next).not.toBe("busy");
    expect(state().chats.find((chat) => chat.id === next)).toMatchObject({
      agentId: "custom",
      providerId: "mistral",
      modelId: "mistral-medium-3-5",
    });

    expect(actions().selectChatAgent("unknown-id", "claude-code")).toBe("unknown-id");
  });

  it("reorders, edits and removes queued messages", () => {
    actions().enqueueAgentMessage("c1", "one");
    actions().enqueueAgentMessage("c1", "two");
    actions().prependAgentMessage("c1", "zero");

    actions().moveQueuedAgentMessage("c1", 0, 2);
    actions().moveQueuedAgentMessage("c1", 5, 0);
    actions().moveQueuedAgentMessage("c1", 0, 0);
    actions().updateQueuedAgentMessage("c1", 0, "ONE");
    expect(state().agentMessageQueues.c1.map((m) => m.content)).toEqual(["ONE", "two", "zero"]);

    actions().removeQueuedAgentMessage("c1", 9);
    actions().removeQueuedAgentMessage("c1", 1);
    expect(actions().dequeueAgentMessage("c1")?.content).toBe("ONE");
    expect(actions().dequeueAgentMessage("c1")?.content).toBe("zero");
    expect(state().agentMessageQueues.c1).toBeUndefined();
    expect(actions().dequeueAgentMessage("c1")).toBeNull();
  });
});

describe("database lifecycle", () => {
  it("logs instead of throwing when the database fails to open or list", async () => {
    db.initChatDatabase.mockRejectedValue(new Error("no db"));
    db.loadAllChatsFromDb.mockRejectedValue(new Error("no db"));

    await actions().initializeDatabase();
    await actions().loadChatsFromDatabase();

    expect(console.error).toHaveBeenCalledWith(
      "Failed to initialize chat database:",
      expect.any(Error),
    );
    expect(console.error).toHaveBeenCalledWith(
      "Failed to load chats from database:",
      expect.any(Error),
    );
  });

  it("merges stored history with chats already open", async () => {
    withChat(session("open", { title: "In memory" }), [message("m", "user", "Hi")]);
    withChat(session("draft"), [], true);
    useAIChatStore.setState((draft) => {
      draft.messagesByChat.stale = [message("s", "user", "old")];
    });
    db.loadAllChatsFromDb.mockResolvedValue([
      session("open", { title: "Stored" }),
      session("stale"),
      session("loading-only"),
    ]);
    useAIChatStore.setState((draft) => {
      draft.chatMessageLoadStates["loading-only"] = "loading";
      draft.messagesByChat["loading-only"] = [message("l", "user", "x")];
    });

    await actions().loadChatsFromDatabase();

    const chats = state().chats;
    expect(chats.map((chat) => chat.id)).toEqual(["open", "stale", "loading-only", "draft"]);
    expect(chats[0].title).toBe("In memory");
    expect(chats[1].messageCount).toBe(0);
    expect(chats[2].messageCount).toBe(1);
    expect(state().messagesByChat.stale).toBeUndefined();
  });

  it("clears every chat and rethrows delete failures", async () => {
    withChat(session("a"), []);
    withChat(session("b"), []);
    useAIChatStore.setState({ currentChatId: "a" });

    await actions().clearAllChats();
    expect(db.deleteChatFromDb).toHaveBeenCalledTimes(2);
    expect(state()).toMatchObject({ chats: [], currentChatId: null, messagesByChat: {} });

    withChat(session("c"), []);
    db.deleteChatFromDb.mockRejectedValueOnce(new Error("locked"));
    await expect(actions().clearAllChats()).rejects.toThrow("locked");
    expect(state().chats).toHaveLength(1);
  });

  it("reads the current chat with its messages", () => {
    expect(actions().getCurrentChat()).toBeUndefined();
    withChat(session("c1"), [message("m", "user", "Hi")]);
    useAIChatStore.setState({ currentChatId: "c1" });
    expect(actions().getCurrentChat()).toMatchObject({ id: "c1", messages: [{ id: "m" }] });
  });
});
