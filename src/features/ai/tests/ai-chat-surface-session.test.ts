import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
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
});
