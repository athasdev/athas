import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openCodexThread } from "@/features/ai/lib/open-codex-thread";

const mocks = vi.hoisted(() => ({
  chats: [] as Array<{
    id: string;
    agentId: string;
    acpSessionId: string | null;
    messages: Array<{ id: string }>;
  }>,
  chatMessageLoadStates: {} as Record<string, string>,
  createNewChat: vi.fn(),
  setChatAcpSessionId: vi.fn(),
  updateChatTitle: vi.fn(),
  getChatById: vi.fn(),
  replaceChatMessages: vi.fn(),
  setChatMessageLoadState: vi.fn(),
  readCodexThreadMessages: vi.fn(),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
}));

vi.mock("@/features/ai/integrations/codex/codex-thread-history", () => ({
  readCodexThreadMessages: mocks.readCodexThreadMessages,
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      chats: mocks.chats,
      chatMessageLoadStates: mocks.chatMessageLoadStates,
      actions: {
        createNewChat: mocks.createNewChat,
        setChatAcpSessionId: mocks.setChatAcpSessionId,
        updateChatTitle: mocks.updateChatTitle,
        getChatById: mocks.getChatById,
        replaceChatMessages: mocks.replaceChatMessages,
        setChatMessageLoadState: mocks.setChatMessageLoadState,
      },
    }),
  },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ actions: { openAgentBuffer: mocks.openAgentBuffer } }),
  },
}));

const thread = {
  id: "thread-1",
  name: "Session menu",
  preview: "Show sessions",
  cwd: "/workspace",
  updatedAt: 42,
};

describe("open Codex thread", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chats = [];
    mocks.chatMessageLoadStates = {};
    mocks.createNewChat.mockImplementation(() => {
      mocks.chats.push({ id: "chat-1", agentId: "codex", acpSessionId: null, messages: [] });
      mocks.chatMessageLoadStates["chat-1"] = "loaded";
      return "chat-1";
    });
    mocks.setChatAcpSessionId.mockImplementation((chatId, sessionId) => {
      const chat = mocks.chats.find((candidate) => candidate.id === chatId);
      if (chat) chat.acpSessionId = sessionId;
    });
    mocks.getChatById.mockImplementation((chatId) =>
      mocks.chats.find((candidate) => candidate.id === chatId),
    );
    mocks.replaceChatMessages.mockImplementation((chatId, messages) => {
      const chat = mocks.chats.find((candidate) => candidate.id === chatId);
      if (chat) chat.messages = messages;
    });
    mocks.setChatMessageLoadState.mockImplementation((chatId, state) => {
      mocks.chatMessageLoadStates[chatId] = state;
    });
    mocks.readCodexThreadMessages.mockResolvedValue([
      { id: "message-1", content: "Loaded", role: "assistant", timestamp: new Date() },
    ]);
  });

  it("creates an Athas chat bound to the selected Codex thread", () => {
    expect(openCodexThread(thread)).toBe("agent://chat-1");
    expect(mocks.createNewChat).toHaveBeenCalledWith("codex", { activate: false });
    expect(mocks.setChatAcpSessionId).toHaveBeenCalledWith("chat-1", "thread-1");
    expect(mocks.updateChatTitle).toHaveBeenCalledWith("chat-1", "Session menu");
    expect(mocks.setChatMessageLoadState).toHaveBeenCalledWith("chat-1", "loading");
    expect(mocks.readCodexThreadMessages).toHaveBeenCalledWith("thread-1");
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
  });

  it("reopens an existing Athas chat for the Codex thread", () => {
    mocks.chats = [
      {
        id: "chat-existing",
        agentId: "codex",
        acpSessionId: "thread-1",
        messages: [{ id: "message-existing" }],
      },
    ];

    openCodexThread(thread);

    expect(mocks.createNewChat).not.toHaveBeenCalled();
    expect(mocks.readCodexThreadMessages).not.toHaveBeenCalled();
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-existing");
  });

  it("hydrates an empty chat from Codex and marks it loaded", async () => {
    openCodexThread(thread);

    await vi.waitFor(() => {
      expect(mocks.replaceChatMessages).toHaveBeenCalledWith("chat-1", [
        expect.objectContaining({ id: "message-1", content: "Loaded" }),
      ]);
      expect(mocks.setChatMessageLoadState).toHaveBeenLastCalledWith("chat-1", "loaded");
    });
  });

  it("shows the session load error when Codex cannot read the thread", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.readCodexThreadMessages.mockRejectedValue(new Error("thread not found"));

    openCodexThread(thread);

    await vi.waitFor(() => {
      expect(mocks.setChatMessageLoadState).toHaveBeenLastCalledWith("chat-1", "error");
    });
  });
});
