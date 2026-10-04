import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: {
    getState: () => ({ rootFolderPath: "/workspace" }),
  },
}));

import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import {
  loadAllChatsFromDb,
  loadChatFromDb,
  saveChatToDb,
} from "@/features/ai/services/ai-chat-history-service";
import type { Chat } from "../types/ai-chat.types";

describe("AI chat surface sessions", () => {
  it("updates only the chosen API session model and preserves CLI sessions", () => {
    const actions = useAIChatStore.getState().actions;
    const first = actions.createNewChat("custom");
    const second = actions.createNewChat("custom");
    const codex = actions.createNewChat("codex");
    const previous = useAIChatStore.getState().chats.find((chat) => chat.id === second)?.modelId;
    actions.setChatModel(first, "anthropic", "claude-test");
    actions.setChatModel(codex, "anthropic", "claude-test");
    expect(useAIChatStore.getState().chats.find((chat) => chat.id === first)).toMatchObject({
      providerId: "anthropic",
      modelId: "claude-test",
    });
    expect(useAIChatStore.getState().chats.find((chat) => chat.id === second)?.modelId).toBe(
      previous,
    );
    expect(useAIChatStore.getState().chats.find((chat) => chat.id === codex)?.modelId).toBeNull();
  });

  it("preserves image-only queued prompts through reordering and dequeue", () => {
    const actions = useAIChatStore.getState().actions;
    const chatId = actions.createNewChat("codex");
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    actions.enqueueAgentMessage(chatId, "", images);
    actions.prependAgentMessage(chatId, "next");
    actions.moveQueuedAgentMessage(chatId, 1, 0);
    expect(actions.dequeueAgentMessage(chatId)).toMatchObject({ content: "", images });
    expect(actions.dequeueAgentMessage(chatId)).toMatchObject({ content: "next" });
    expect(actions.dequeueAgentMessage(chatId)).toBeNull();
  });

  beforeEach(() => {
    useAIChatStore.setState({
      chats: [],
      currentChatId: null,
      pendingAgentLaunchRequest: null,
      agentRuns: {},
      agentMessageQueues: {},
      chatMessageLoadStates: {},
    });
  });

  it("creates an editor-tab session without replacing the sidebar session", () => {
    const sidebarChatId = useAIChatStore.getState().actions.createNewChat("custom");
    const tabChatId = useAIChatStore
      .getState()
      .actions.createNewChat("custom", { activate: false });

    expect(tabChatId).not.toBe(sidebarChatId);
    expect(useAIChatStore.getState().currentChatId).toBe(sidebarChatId);
    expect(useAIChatStore.getState().chats.map((chat) => chat.id)).toContain(tabChatId);
  });

  it("ensures a missing tab session without activating it in the sidebar", () => {
    const sidebarChatId = useAIChatStore.getState().actions.createNewChat("custom");

    useAIChatStore
      .getState()
      .actions.ensureChatSession("tab-session", "custom", { activate: false });

    expect(useAIChatStore.getState().currentChatId).toBe(sidebarChatId);
    expect(useAIChatStore.getState().actions.getChatById("tab-session")).toBeDefined();
  });

  it("pins and unpins a session", () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("custom");

    useAIChatStore.getState().actions.setChatPinned(chatId, true);
    expect(useAIChatStore.getState().actions.getChatById(chatId)?.isPinned).toBe(true);

    useAIChatStore.getState().actions.setChatPinned(chatId, false);
    expect(useAIChatStore.getState().actions.getChatById(chatId)?.isPinned).toBe(false);
  });

  it("archives a session and activates the next available session", () => {
    const firstChatId = useAIChatStore.getState().actions.createNewChat("custom");
    const secondChatId = useAIChatStore.getState().actions.createNewChat("custom");

    useAIChatStore.getState().actions.setChatPinned(secondChatId, true);
    useAIChatStore.getState().actions.setChatArchived(secondChatId, true);

    const state = useAIChatStore.getState();
    expect(state.actions.getChatById(secondChatId)?.archivedAt).toBeInstanceOf(Date);
    expect(state.actions.getChatById(secondChatId)?.isPinned).toBe(false);
    expect(state.currentChatId).toBe(firstChatId);
  });

  it("restores an archived session without activating it", () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("custom");

    useAIChatStore.getState().actions.setChatArchived(chatId, true);
    useAIChatStore.getState().actions.setChatArchived(chatId, false);

    expect(useAIChatStore.getState().actions.getChatById(chatId)?.archivedAt).toBeNull();
  });

  it("keeps one run and queue per chat across surfaces", () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("codex");
    const actions = useAIChatStore.getState().actions;

    actions.startAgentRun(chatId, {
      runId: "run-1",
      assistantMessageId: "assistant-1",
      agentId: "codex",
      phase: "starting",
    });
    actions.enqueueAgentMessage(chatId, "second message");

    expect(useAIChatStore.getState().agentRuns[chatId]).toMatchObject({
      runId: "run-1",
      phase: "starting",
    });
    expect(actions.dequeueAgentMessage(chatId)).toMatchObject({ content: "second message" });

    actions.finishAgentRun(chatId, "run-1");
    expect(useAIChatStore.getState().agentRuns[chatId]).toBeUndefined();
  });

  it("lets users prioritize, reorder, and remove queued guidance", () => {
    const chatId = useAIChatStore.getState().actions.createNewChat("codex");
    const actions = useAIChatStore.getState().actions;

    actions.enqueueAgentMessage(chatId, "later");
    actions.enqueueAgentMessage(chatId, "last");
    actions.prependAgentMessage(chatId, "interrupt now");
    actions.moveQueuedAgentMessage(chatId, 2, 1);

    expect(useAIChatStore.getState().agentMessageQueues[chatId]).toMatchObject([
      { content: "interrupt now" },
      { content: "last" },
      { content: "later" },
    ]);

    actions.removeQueuedAgentMessage(chatId, 1);
    expect(useAIChatStore.getState().agentMessageQueues[chatId]).toMatchObject([
      { content: "interrupt now" },
      { content: "later" },
    ]);
  });
});

describe("AI chat history loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAIChatStore.setState({
      chats: [],
      currentChatId: null,
      pendingAgentLaunchRequest: null,
      agentRuns: {},
      agentMessageQueues: {},
      chatMessageLoadStates: {},
    });
  });

  const historyRow = (id: string) => {
    const createdAt = new Date("2026-09-18T10:00:00Z");
    return {
      id,
      title: "New Session",
      createdAt,
      lastMessageAt: new Date(createdAt),
      agentId: "custom" as const,
      acpSessionId: null,
      workspacePath: "/workspace",
      providerId: "anthropic",
      modelId: "claude-test",
      branch: null,
      isPinned: false,
      archivedAt: null,
    };
  };

  it("leaves unloaded history rows without a load state", async () => {
    vi.mocked(loadAllChatsFromDb).mockResolvedValue([historyRow("old")]);

    await useAIChatStore.getState().actions.loadChatsFromDatabase();

    expect(useAIChatStore.getState().chatMessageLoadStates.old).toBeUndefined();
  });

  it("loads a persisted empty session when New Agent reuses it", async () => {
    vi.mocked(loadAllChatsFromDb).mockResolvedValue([historyRow("old")]);
    vi.mocked(loadChatFromDb).mockResolvedValue({ ...historyRow("old"), messages: [] });
    await useAIChatStore.getState().actions.loadChatsFromDatabase();

    const chatId = useAIChatStore
      .getState()
      .actions.createNewChat("custom", { activate: false, reuseEmpty: true });

    expect(chatId).toBe("old");
    expect(loadChatFromDb).toHaveBeenCalledWith("old");
    await vi.waitFor(() => {
      expect(useAIChatStore.getState().chatMessageLoadStates.old).toBe("loaded");
    });
  });

  it("prefers an empty session that is already in memory over an unloaded row", async () => {
    vi.mocked(loadAllChatsFromDb).mockResolvedValue([historyRow("old")]);
    await useAIChatStore.getState().actions.loadChatsFromDatabase();
    const inMemoryId = useAIChatStore.getState().actions.createNewChat("custom");

    const chatId = useAIChatStore
      .getState()
      .actions.createNewChat("custom", { activate: false, reuseEmpty: true });

    expect(chatId).toBe(inMemoryId);
    expect(loadChatFromDb).not.toHaveBeenCalled();
  });

  it("does not start a second fetch while one is in flight", () => {
    useAIChatStore.setState({
      chats: [{ ...historyRow("old"), messages: [] }],
      chatMessageLoadStates: { old: "loading" },
    });

    useAIChatStore.getState().actions.switchToChat("old");

    expect(loadChatFromDb).not.toHaveBeenCalled();
  });

  it("shares one history load between simultaneous consumers", async () => {
    let resolve: (chat: Chat) => void = () => {};
    vi.mocked(loadChatFromDb).mockImplementationOnce(
      () =>
        new Promise<Chat>((done) => {
          resolve = done;
        }),
    );
    useAIChatStore.setState({ chats: [{ ...historyRow("shared-load"), messages: [] }] });
    const actions = useAIChatStore.getState().actions;
    const first = actions.loadChatMessages("shared-load");
    const second = actions.loadChatMessages("shared-load");
    expect(loadChatFromDb).toHaveBeenCalledTimes(1);
    resolve({ ...historyRow("shared-load"), messages: [] });
    await Promise.all([first, second]);
    expect(useAIChatStore.getState().chatMessageLoadStates["shared-load"]).toBe("loaded");
  });

  it("merges live replies with persisted history without resetting session choices", async () => {
    let resolve: (chat: Chat) => void = () => {};
    vi.mocked(loadChatFromDb).mockImplementationOnce(
      () =>
        new Promise<Chat>((done) => {
          resolve = done;
        }),
    );
    const row = historyRow("live-load");
    useAIChatStore.setState({ chats: [{ ...row, messages: [] }] });
    const actions = useAIChatStore.getState().actions;
    const loading = actions.loadChatMessages(row.id);
    actions.setChatPinned(row.id, true);
    actions.setChatModel(row.id, "openai", "new-model");
    actions.addMessage(row.id, {
      id: "live",
      role: "assistant",
      content: "Hello",
      timestamp: row.createdAt,
      isStreaming: true,
    });
    actions.appendMessageContent(row.id, "live", " world");
    expect(saveChatToDb).not.toHaveBeenCalled();
    resolve({
      ...row,
      messages: [{ id: "old", role: "user", content: "Earlier", timestamp: row.createdAt }],
    });
    await loading;
    const chat = actions.getChatById(row.id);
    expect(chat).toMatchObject({ isPinned: true, providerId: "openai", modelId: "new-model" });
    expect(chat?.messages.map(({ id, content }) => ({ id, content }))).toEqual([
      { id: "old", content: "Earlier" },
      { id: "live", content: "Hello world" },
    ]);
    expect(saveChatToDb).toHaveBeenCalledWith(
      expect.objectContaining({ messages: chat?.messages }),
    );
  });

  it("preserves edited and truncated messages when a reload finishes", async () => {
    let resolve: (chat: Chat) => void = () => {};
    vi.mocked(loadChatFromDb).mockImplementationOnce(
      () =>
        new Promise<Chat>((done) => {
          resolve = done;
        }),
    );
    const chat: Chat = {
      ...historyRow("edited-load"),
      messages: [
        { id: "user", role: "user", content: "Before", timestamp: new Date() },
        { id: "reply", role: "assistant", content: "Old reply", timestamp: new Date() },
      ],
    };
    useAIChatStore.setState({ chats: [chat] });
    const actions = useAIChatStore.getState().actions;
    const loading = actions.loadChatMessages(chat.id);
    actions.replaceUserMessage(chat.id, "user", "Changed");
    resolve(chat);
    await loading;
    expect(actions.getChatById(chat.id)?.messages).toHaveLength(1);
    expect(actions.getChatById(chat.id)?.messages[0].content).toBe("Changed");
  });

  it("keeps a live session when its history row is missing", async () => {
    let reject: (reason: Error) => void = () => {};
    vi.mocked(loadChatFromDb).mockImplementationOnce(
      () =>
        new Promise<Chat>((resolve, fail) => {
          void resolve;
          reject = fail;
        }),
    );
    const row = historyRow("missing-live");
    useAIChatStore.setState({ chats: [{ ...row, messages: [] }] });
    const actions = useAIChatStore.getState().actions;
    const loading = actions.loadChatMessages(row.id);
    actions.addMessage(row.id, {
      id: "new",
      role: "user",
      content: "Live",
      timestamp: row.createdAt,
    });
    reject(new Error("Query returned no rows"));
    await loading;
    expect(actions.getChatById(row.id)?.messages[0].content).toBe("Live");
    expect(useAIChatStore.getState().chatMessageLoadStates[row.id]).toBe("loaded");
  });

  it("does not restore a removed chat or its loading state", async () => {
    let resolve: (chat: Chat) => void = () => {};
    vi.mocked(loadChatFromDb).mockImplementationOnce(
      () =>
        new Promise<Chat>((done) => {
          resolve = done;
        }),
    );
    const row = historyRow("removed-load");
    useAIChatStore.setState({ chats: [{ ...row, messages: [] }] });
    const loading = useAIChatStore.getState().actions.loadChatMessages(row.id);
    useAIChatStore.setState({ chats: [], chatMessageLoadStates: {} });
    resolve({ ...row, messages: [] });
    await loading;
    expect(useAIChatStore.getState().chats).toEqual([]);
    expect(useAIChatStore.getState().chatMessageLoadStates[row.id]).toBeUndefined();
  });

  it("loads the session that takes over after the current one is archived", async () => {
    vi.mocked(loadAllChatsFromDb).mockResolvedValue([historyRow("old")]);
    vi.mocked(loadChatFromDb).mockResolvedValue({ ...historyRow("old"), messages: [] });
    await useAIChatStore.getState().actions.loadChatsFromDatabase();
    const currentId = useAIChatStore.getState().actions.createNewChat("custom");

    useAIChatStore.getState().actions.setChatArchived(currentId, true);

    expect(useAIChatStore.getState().currentChatId).toBe("old");
    expect(loadChatFromDb).toHaveBeenCalledWith("old");
  });
});
