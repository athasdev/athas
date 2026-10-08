import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import {
  deleteChatFromDb,
  loadChatFromDb,
  saveChatToDb,
} from "@/features/ai/services/ai-chat-history-service";
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
  it("round-trips image attachments through the persisted history payload", async () => {
    const chat = createChat("image-chat", "");
    chat.messages[0].role = "user";
    chat.messages[0].isStreaming = false;
    chat.messages[0].images = [{ mediaType: "image/png", data: "YWJj" }];
    vi.mocked(invoke).mockResolvedValue(undefined);
    await saveChatToDb(chat);
    const saved = vi.mocked(invoke).mock.calls[0][1];
    expect(saved).toMatchObject({
      messages: [expect.objectContaining({ images: JSON.stringify(chat.messages[0].images) })],
    });
    vi.mocked(invoke).mockResolvedValue({ ...saved, tool_calls: [] });
    const restored = await loadChatFromDb(chat.id);
    expect(restored.messages[0].images).toEqual(chat.messages[0].images);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps a turn's token usage across a restart", async () => {
    const chat = createChat("usage-chat", "Done");
    chat.messages[0].isStreaming = false;
    chat.messages[0].turnUsage = { totalTokens: 30, inputTokens: 20, outputTokens: 10 };
    vi.mocked(invoke).mockResolvedValue(undefined);
    await saveChatToDb(chat);
    const saved = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    vi.mocked(invoke).mockResolvedValue({ ...saved, tool_calls: [] });

    const restored = await loadChatFromDb(chat.id);

    expect(restored.messages[0].turnUsage).toEqual(chat.messages[0].turnUsage);
  });

  it("keeps a tool call's terminal output across a restart", async () => {
    const chat = createChat("terminal-chat", "Ran it");
    chat.messages[0].isStreaming = false;
    const terminals = {
      t1: { output: "ok\n", truncated: false, exit: { exitCode: 0, signal: null } },
    };
    chat.messages[0].toolCalls = [
      {
        id: "call-1",
        name: "ls",
        input: {},
        output: [{ type: "terminal", terminalId: "t1" }],
        timestamp: new Date(2),
        isComplete: true,
        terminals,
      },
    ];
    vi.mocked(invoke).mockResolvedValue(undefined);
    await saveChatToDb(chat);
    const saved = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    vi.mocked(invoke).mockResolvedValue({ ...saved, tool_calls: saved.toolCalls });

    const restored = await loadChatFromDb(chat.id);

    expect(restored.messages[0].toolCalls?.[0].terminals).toEqual(terminals);
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
    const latestSave = saveChatToDb({
      ...chat,
      messages: [{ ...chat.messages[0], content: "latest", isStreaming: false }],
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    resolveFirstSave?.();
    await firstSave;
    await latestSave;

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1]?.[1]).toMatchObject({
      messages: [expect.objectContaining({ content: "latest", is_streaming: false })],
    });
  });

  it("writes a chat whole once, then only the messages that changed", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const prompt = {
      id: "user-1",
      role: "user" as const,
      content: "Hi",
      timestamp: new Date(1),
    };
    const chat = createChat("partial-chat", "Hel");
    chat.messages = [prompt, chat.messages[0]];
    await saveChatToDb(chat);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      scope: "allMessages",
      messages: [
        expect.objectContaining({ id: "user-1" }),
        expect.objectContaining({ id: "assistant-1" }),
      ],
    });

    const streamed = { ...chat, messages: [prompt, { ...chat.messages[1], content: "Hello" }] };
    await saveChatToDb(streamed);
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      scope: "changedMessages",
      messages: [expect.objectContaining({ id: "assistant-1", content: "Hello" })],
    });
    expect((vi.mocked(invoke).mock.calls[1][1] as { messages: unknown[] }).messages).toHaveLength(
      1,
    );

    await saveChatToDb({ ...streamed, title: "Renamed" });
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({
      scope: "changedMessages",
      messages: [],
      chat: expect.objectContaining({ title: "Renamed" }),
    });

    await saveChatToDb({ ...streamed, messages: [prompt] });
    expect(vi.mocked(invoke).mock.calls[3][1]).toMatchObject({
      scope: "allMessages",
      messages: [expect.objectContaining({ id: "user-1" })],
    });
  });

  it("writes a chat whole again after a save fails", async () => {
    const chat = createChat("failing-chat", "Hel");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await saveChatToDb(chat);
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    const streamed = { ...chat, messages: [{ ...chat.messages[0], content: "Hello" }] };
    await expect(saveChatToDb(streamed)).rejects.toThrow("disk full");
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await saveChatToDb(streamed);
    expect(vi.mocked(invoke).mock.calls[2][1]).toMatchObject({ scope: "allMessages" });
  });

  it("never writes an empty chat whole before it was saved with messages", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    const chat = { ...createChat("unloaded-chat", ""), messages: [] };
    await saveChatToDb(chat);
    expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
      scope: "changedMessages",
      messages: [],
    });
    await saveChatToDb(createChat("unloaded-chat", "Loaded"));
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({ scope: "allMessages" });
  });

  it("does not keep a baseline that a deletion forgot while the save was in flight", async () => {
    let finishSave: (() => void) | undefined;
    vi.mocked(invoke).mockImplementation((command: string) =>
      command === "save_chat" && !finishSave
        ? new Promise<undefined>((resolve) => {
            finishSave = () => resolve(undefined);
          })
        : Promise.resolve(undefined),
    );
    const chat = createChat("deleted-chat", "Hello");
    const saving = saveChatToDb(chat);
    await Promise.resolve();
    await deleteChatFromDb(chat.id);
    finishSave?.();
    await saving;

    await saveChatToDb({ ...chat, messages: [{ ...chat.messages[0], content: "Hello again" }] });
    const saves = vi.mocked(invoke).mock.calls.filter(([command]) => command === "save_chat");
    expect(saves[saves.length - 1]?.[1]).toMatchObject({ scope: "allMessages" });
  });

  it("still writes a state queued behind a save that failed", async () => {
    let failSave: ((error: Error) => void) | undefined;
    vi.mocked(invoke).mockImplementation(() =>
      failSave
        ? Promise.resolve(undefined)
        : new Promise((_, reject) => {
            failSave = reject;
          }),
    );
    const chat = createChat("retried-chat", "first");
    const failing = saveChatToDb(chat).catch(() => undefined);
    await Promise.resolve();
    void saveChatToDb({ ...chat, messages: [{ ...chat.messages[0], content: "queued" }] }).catch(
      () => undefined,
    );
    failSave?.(new Error("busy"));
    await failing;
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({
      scope: "allMessages",
      messages: [expect.objectContaining({ content: "queued" })],
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
