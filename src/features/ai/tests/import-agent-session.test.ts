import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { importAgentSession } from "@/features/ai/lib/import-agent-session";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import type { Message } from "@/features/ai/types/ai-chat.types";

const { store } = vi.hoisted(() => {
  const store = {
    chats: [] as Array<{ id: string; agentId: string; acpSessionId: string | null }>,
    actions: {
      createNewChat: vi.fn(() => "new-chat"),
      setChatAcpSessionId: vi.fn(),
      updateChatTitle: vi.fn(),
      replaceChatMessages: vi.fn(),
    },
  };
  return { store };
});

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: () => store },
}));

vi.mock("@/features/ai/lib/open-agent-history", () => ({
  openAgentHistoryChat: vi.fn(),
}));

vi.mock("@/features/ai/services/acp-stream-handler", () => ({
  AcpStreamHandler: { importSession: vi.fn() },
}));

describe("importAgentSession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.chats = [];
  });

  it("puts the replayed conversation into a new chat on the imported session", async () => {
    vi.mocked(AcpStreamHandler.importSession).mockResolvedValue({
      sessionId: "agent-session",
      status: { agentId: "claude-code", running: true } as never,
      history: [
        {
          type: "user_message_chunk",
          sessionId: "agent-session",
          content: { type: "text", text: "Hello" },
          isComplete: false,
        },
        {
          type: "content_chunk",
          sessionId: "agent-session",
          content: { type: "text", text: "Hi there" },
          isComplete: false,
        },
      ],
    });

    const chatId = await importAgentSession("claude-code", {
      sessionId: "agent-session",
      title: "Greeting",
      updatedAt: "2026-09-01T12:00:00Z",
    });

    expect(chatId).toBe("new-chat");
    expect(AcpStreamHandler.importSession).toHaveBeenCalledWith("claude-code", "agent-session");
    expect(store.actions.createNewChat).toHaveBeenCalledWith("claude-code", { activate: false });
    expect(store.actions.setChatAcpSessionId).toHaveBeenCalledWith("new-chat", "agent-session");
    expect(store.actions.updateChatTitle).toHaveBeenCalledWith("new-chat", "Greeting");
    const [targetChat, messages] = store.actions.replaceChatMessages.mock.calls[0] as unknown as [
      string,
      Message[],
    ];
    expect(targetChat).toBe("new-chat");
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ]);
    expect(messages[1].timestamp.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(openAgentHistoryChat).toHaveBeenCalledWith("new-chat");
  });

  it("opens the chat that already holds the session instead of importing it again", async () => {
    store.chats = [{ id: "existing", agentId: "claude-code", acpSessionId: "agent-session" }];

    const chatId = await importAgentSession("claude-code", { sessionId: "agent-session" });

    expect(chatId).toBe("existing");
    expect(AcpStreamHandler.importSession).not.toHaveBeenCalled();
    expect(store.actions.createNewChat).not.toHaveBeenCalled();
    expect(openAgentHistoryChat).toHaveBeenCalledWith("existing");
  });

  it("creates no chat when the agent cannot load the session", async () => {
    vi.mocked(AcpStreamHandler.importSession).mockRejectedValue(
      new Error("The agent could not load session agent-session"),
    );

    await expect(importAgentSession("claude-code", { sessionId: "agent-session" })).rejects.toThrow(
      "could not load",
    );
    expect(store.actions.createNewChat).not.toHaveBeenCalled();
  });
});
