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

describe("AI chat surface sessions", () => {
  it("preserves image-only queued prompts through reordering and dequeue", () => {
    const actions = useAIChatStore.getState().actions;
    const chatId = actions.createNewChat("codex");
    const images = [{ mediaType: "image/png", data: "YWJj" }];
    actions.enqueueAgentMessage(chatId, "", images);
    actions.prependAgentMessage(chatId, "next");
    actions.moveQueuedAgentMessage(chatId, 1, 0);
    expect(actions.dequeueAgentMessage(chatId)).toEqual({ content: "", images });
    expect(actions.dequeueAgentMessage(chatId)).toEqual({ content: "next" });
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
    expect(actions.dequeueAgentMessage(chatId)).toEqual({ content: "second message" });

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

    expect(useAIChatStore.getState().agentMessageQueues[chatId]).toEqual([
      { content: "interrupt now" },
      { content: "last" },
      { content: "later" },
    ]);

    actions.removeQueuedAgentMessage(chatId, 1);
    expect(useAIChatStore.getState().agentMessageQueues[chatId]).toEqual([
      { content: "interrupt now" },
      { content: "later" },
    ]);
  });
});
