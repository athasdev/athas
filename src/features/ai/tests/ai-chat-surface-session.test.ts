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
  beforeEach(() => {
    useAIChatStore.setState({
      chats: [],
      currentChatId: null,
      pendingAgentLaunchRequest: null,
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
});
