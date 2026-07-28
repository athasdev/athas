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
      activeAgentChatIds: [],
      pendingAgentLaunchRequest: null,
    });
  });

  it("creates an editor-tab session without replacing the sidebar session", () => {
    const sidebarChatId = useAIChatStore.getState().createNewChat("custom");
    const tabChatId = useAIChatStore.getState().createNewChat("custom", { activate: false });

    expect(tabChatId).not.toBe(sidebarChatId);
    expect(useAIChatStore.getState().currentChatId).toBe(sidebarChatId);
    expect(useAIChatStore.getState().chats.map((chat) => chat.id)).toContain(tabChatId);
  });

  it("ensures a missing tab session without activating it in the sidebar", () => {
    const sidebarChatId = useAIChatStore.getState().createNewChat("custom");

    useAIChatStore.getState().ensureChatSession("tab-session", "custom", { activate: false });

    expect(useAIChatStore.getState().currentChatId).toBe(sidebarChatId);
    expect(useAIChatStore.getState().getChatById("tab-session")).toBeDefined();
  });

  it("pins and unpins a session", () => {
    const chatId = useAIChatStore.getState().createNewChat("custom");

    useAIChatStore.getState().setChatPinned(chatId, true);
    expect(useAIChatStore.getState().getChatById(chatId)?.isPinned).toBe(true);

    useAIChatStore.getState().setChatPinned(chatId, false);
    expect(useAIChatStore.getState().getChatById(chatId)?.isPinned).toBe(false);
  });

  it("archives a session and activates the next available session", () => {
    const firstChatId = useAIChatStore.getState().createNewChat("custom");
    const secondChatId = useAIChatStore.getState().createNewChat("custom");

    useAIChatStore.getState().setChatPinned(secondChatId, true);
    useAIChatStore.getState().setChatArchived(secondChatId, true);

    const state = useAIChatStore.getState();
    expect(state.getChatById(secondChatId)?.archivedAt).toBeInstanceOf(Date);
    expect(state.getChatById(secondChatId)?.isPinned).toBe(false);
    expect(state.currentChatId).toBe(firstChatId);
  });

  it("restores an archived session without activating it", () => {
    const chatId = useAIChatStore.getState().createNewChat("custom");

    useAIChatStore.getState().setChatArchived(chatId, true);
    useAIChatStore.getState().setChatArchived(chatId, false);

    expect(useAIChatStore.getState().getChatById(chatId)?.archivedAt).toBeNull();
  });
});
