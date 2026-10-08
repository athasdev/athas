// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { normalizeChats } from "@/features/ai/stores/ai-chat/chat-normalization";
import type { Chat } from "@/features/ai/types/ai-chat.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));
vi.mock("@/features/ai/services/ai-chat-history-service", () => ({
  deleteChatFromDb: vi.fn(),
  initChatDatabase: vi.fn(),
  loadAllChatsFromDb: vi.fn(),
  loadChatFromDb: vi.fn(),
  saveChatMetadataToDb: vi.fn().mockResolvedValue(undefined),
  saveChatToDb: vi.fn().mockResolvedValue(undefined),
}));

const startedAt = new Date("2026-01-01T00:00:00Z");

function chat(id: string): Chat {
  return {
    id,
    title: id,
    messages: [
      { id: "prompt", role: "user", content: "Hi", timestamp: startedAt },
      { id: "reply", role: "assistant", content: "", timestamp: startedAt, isStreaming: true },
    ],
    createdAt: startedAt,
    lastMessageAt: startedAt,
    agentId: "custom",
  };
}

const actions = () => useAIChatStore.getState().actions;
const reply = (chatId = "a") => useAIChatStore.getState().messagesByChat[chatId]![1]!;

describe("streamed message updates", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
    useAIChatStore.setState(normalizeChats([chat("a"), chat("b")]));
  });
  afterEach(() => {
    actions().flushMessageUpdates();
    vi.useRealTimers();
  });

  it("coalesces chunks into one store write per frame", () => {
    const listener = vi.fn();
    const unsubscribe = useAIChatStore.subscribe(listener);
    actions().appendMessageContent("a", "reply", "Hel");
    actions().appendMessageContent("a", "reply", "lo");
    actions().queueMessageUpdate("a", "reply", { responsePhase: undefined });
    actions().appendMessageContent("a", "reply", " there");
    expect(listener).not.toHaveBeenCalled();
    expect(reply().content).toBe("");

    vi.advanceTimersToNextFrame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(reply().content).toBe("Hello there");
    unsubscribe();
  });

  it("lets a full content replacement win over earlier appends", () => {
    actions().appendMessageContent("a", "reply", "draft");
    actions().queueMessageUpdate("a", "reply", { content: "Final" });
    actions().appendMessageContent("a", "reply", "!");
    vi.advanceTimersToNextFrame();
    expect(reply().content).toBe("Final!");
  });

  it("computes a function update once, when the frame lands, from the latest state", () => {
    let text = "";
    const resolve = vi.fn(() => ({ content: text }));
    for (const chunk of ["Hel", "lo", " there"]) {
      text += chunk;
      actions().queueMessageUpdate("a", "reply", resolve);
    }
    expect(resolve).not.toHaveBeenCalled();

    vi.advanceTimersToNextFrame();
    expect(resolve).toHaveBeenCalledOnce();
    expect(reply().content).toBe("Hello there");
  });

  it("orders plain updates and appends around a function update", () => {
    actions().appendMessageContent("a", "reply", "dropped");
    actions().queueMessageUpdate("a", "reply", { responsePhase: "thinking" });
    actions().queueMessageUpdate("a", "reply", () => ({
      content: "Streamed",
      responsePhase: undefined,
    }));
    actions().queueMessageUpdate("a", "reply", { responsePhase: "waiting" });
    actions().appendMessageContent("a", "reply", "!");
    vi.advanceTimersToNextFrame();
    expect(reply()).toMatchObject({ content: "Streamed!", responsePhase: "waiting" });
  });

  it("keeps the session order still until the turn ends", () => {
    actions().queueMessageUpdate("a", "reply", { content: "Working" });
    vi.advanceTimersToNextFrame();
    actions().updateMessage("a", "reply", { responsePhase: "thinking" });
    const chatA = () => useAIChatStore.getState().chats[0]!;
    expect(chatA().lastMessageAt).toBe(startedAt);

    actions().updateMessage("a", "reply", { isStreaming: false });
    expect(chatA().lastMessageAt.getTime()).toBeGreaterThan(startedAt.getTime());
  });

  it("applies queued chunks before a direct update and before reads", () => {
    actions().appendMessageContent("a", "reply", "Partial");
    actions().updateMessage("a", "reply", { isStreaming: false });
    expect(reply()).toMatchObject({ content: "Partial", isStreaming: false });

    actions().appendMessageContent("b", "reply", "Other chat");
    expect(actions().getMessagesForChat("b")[1]!.content).toBe("Other chat");
  });

  it("does not replace other chats while one streams", () => {
    const before = useAIChatStore.getState().chats[1];
    actions().appendMessageContent("a", "reply", "token");
    vi.advanceTimersToNextFrame();
    expect(useAIChatStore.getState().chats[1]).toBe(before);
  });

  it("changes only the streamed message, leaving the session list and other messages alone", () => {
    const before = useAIChatStore.getState();
    actions().appendMessageContent("a", "reply", "token");
    vi.advanceTimersToNextFrame();
    const after = useAIChatStore.getState();

    expect(after.messagesByChat.a![1]!.content).toBe("token");
    expect(after.messagesByChat.a![1]).not.toBe(before.messagesByChat.a![1]);
    expect(after.chats).toBe(before.chats);
    expect(after.chats[0]).toBe(before.chats[0]);
    expect(after.messagesByChat.a![0]).toBe(before.messagesByChat.a![0]);
    expect(after.messagesByChat.b).toBe(before.messagesByChat.b);
  });

  it("updates the session list when a message is added, not per token", () => {
    const before = useAIChatStore.getState().chats;
    actions().addMessage("a", {
      id: "next",
      role: "user",
      content: "More",
      timestamp: new Date(),
    });
    const after = useAIChatStore.getState().chats;
    expect(after).not.toBe(before);
    expect(after[0]).toMatchObject({ messageCount: 3 });
    expect(after[1]).toBe(before[1]);
  });

  it("gives every tool call written to the store an id", () => {
    const timestamp = new Date();
    actions().addMessage("a", {
      id: "command",
      role: "system",
      content: "$ ls",
      timestamp,
      toolCalls: [{ name: "terminal", input: {}, timestamp }],
    });
    const command = () =>
      useAIChatStore.getState().messagesByChat.a!.find((message) => message.id === "command")!;
    const added = command().toolCalls![0]!;
    expect(added.id).toEqual(expect.any(String));

    actions().updateMessage("a", "command", {
      toolCalls: [added, { name: "terminal", input: {}, timestamp }],
    });
    const [kept, appended] = command().toolCalls!;
    expect(kept!.id).toBe(added.id);
    expect(appended!.id).toEqual(expect.any(String));
    expect(appended!.id).not.toBe(added.id);

    actions().queueMessageUpdate("a", "reply", {
      toolCalls: [{ name: "Read", input: {}, timestamp }],
    });
    actions().flushMessageUpdates("a");
    expect(reply().toolCalls![0]!.id).toEqual(expect.any(String));
  });
});
