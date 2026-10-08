// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
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
const reply = (chatId = "a") =>
  useAIChatStore.getState().chats.find((candidate) => candidate.id === chatId)!.messages[1]!;

describe("streamed message updates", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
    useAIChatStore.setState({ chats: [chat("a"), chat("b")] });
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
});
