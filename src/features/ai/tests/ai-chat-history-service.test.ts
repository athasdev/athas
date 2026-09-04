import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { loadChatFromDb, saveChatToDb } from "@/features/ai/services/ai-chat-history-service";
import type { Chat } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

function createChat(id: string, content: string): Chat {
  return {
    id,
    title: "Session",
    messages: [
      {
        id: "assistant-1",
        role: "assistant",
        content,
        timestamp: new Date(2),
        isStreaming: true,
      },
    ],
    createdAt: new Date(1),
    lastMessageAt: new Date(2),
    agentId: "codex",
  };
}

describe("AI chat history service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes and coalesces saves for the same chat", async () => {
    let resolveFirstSave: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation(() => {
      if (resolveFirstSave) return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveFirstSave = resolve;
      });
    });
    const chat = createChat("serialized-chat", "first");

    const firstSave = saveChatToDb(chat);
    await Promise.resolve();
    chat.messages[0].content = "latest";
    chat.messages[0].isStreaming = false;
    const latestSave = saveChatToDb(chat);

    expect(invoke).toHaveBeenCalledTimes(1);
    resolveFirstSave?.();
    await firstSave;
    await latestSave;

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1]?.[1]).toMatchObject({
      messages: [expect.objectContaining({ content: "latest", is_streaming: false })],
    });
  });

  it("does not restore stale streaming state after an app restart", async () => {
    vi.mocked(invoke).mockResolvedValue({
      chat: {
        id: "loaded-chat",
        title: "Session",
        created_at: 1,
        last_message_at: 2,
        agent_id: "codex",
        acp_session_id: null,
        workspace_path: null,
        provider_id: null,
        model_id: null,
        branch: null,
        is_pinned: false,
        archived_at: null,
      },
      messages: [
        {
          id: "assistant-1",
          chat_id: "loaded-chat",
          role: "assistant",
          content: "Interrupted response",
          timestamp: 2,
          is_streaming: true,
          is_tool_use: false,
          tool_name: null,
        },
      ],
      tool_calls: [],
    });

    const chat = await loadChatFromDb("loaded-chat");

    expect(chat.messages[0].isStreaming).toBe(false);
  });

  it("restores consecutive assistant segments as one response", async () => {
    vi.mocked(invoke).mockResolvedValue({
      chat: {
        id: "loaded-chat",
        title: "Session",
        created_at: 1,
        last_message_at: 3,
        agent_id: "codex",
        acp_session_id: null,
        workspace_path: null,
        provider_id: null,
        model_id: null,
        branch: null,
        is_pinned: false,
        archived_at: null,
      },
      messages: [
        {
          id: "assistant-1",
          chat_id: "loaded-chat",
          role: "assistant",
          content: "First segment",
          timestamp: 2,
          is_streaming: false,
          is_tool_use: false,
          tool_name: null,
        },
        {
          id: "assistant-2",
          chat_id: "loaded-chat",
          role: "assistant",
          content: "Second segment",
          timestamp: 3,
          is_streaming: false,
          is_tool_use: false,
          tool_name: null,
        },
      ],
      tool_calls: [],
    });

    const chat = await loadChatFromDb("loaded-chat");

    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({
      id: "assistant-1",
      content: "First segment\n\nSecond segment",
    });
  });
});
