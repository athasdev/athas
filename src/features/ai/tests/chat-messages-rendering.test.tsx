// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import { normalizeChats } from "@/features/ai/services/chat-normalization";
import type { Chat, Message } from "@/features/ai/types/ai-chat.types";
import { ChatMessages } from "@/features/ai/components/chat/chat-messages";

const renders = vi.hoisted(() => new Map<string, number>());
const timelineBuilds = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/features/ai/lib/chat-timeline", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/ai/lib/chat-timeline")>();
  return {
    ...original,
    buildChatTimeline: (...args: Parameters<typeof original.buildChatTimeline>) => {
      timelineBuilds.count += 1;
      return original.buildChatTimeline(...args);
    },
  };
});

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
vi.mock("@/ui/message-scroller", () => ({
  MessageScrollerContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MessageScrollerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMessageScroller: () => ({ scrollToMessage: () => undefined }),
}));
vi.mock("@/features/ai/components/chat/chat-message", () => ({
  ChatMessage: ({ message }: { message: Message }) => {
    renders.set(message.id, (renders.get(message.id) ?? 0) + 1);
    return <p>{message.content}</p>;
  },
}));
vi.mock("@/features/ai/components/chat/agent-shortcuts", () => ({ AgentShortcuts: () => null }));
vi.mock("@/features/ai/components/chat/acp-inline-event", () => ({ AcpInlineEvent: () => null }));
vi.mock("@/features/ai/components/chat/chat-follow-up-actions", () => ({
  ChatFollowUpActions: () => null,
}));

const at = new Date("2026-01-01T00:00:00Z");

function chat(id: string, messages: Message[]): Chat {
  return { id, title: id, messages, createdAt: at, lastMessageAt: at, agentId: "custom" };
}

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  renders.clear();
  timelineBuilds.count = 0;
  useAIChatStore.setState({
    currentChatId: "a",
    ...normalizeChats([
      chat("a", [
        { id: "prompt", role: "user", content: "Hi", timestamp: at },
        { id: "reply", role: "assistant", content: "", timestamp: at, isStreaming: true },
      ]),
      chat("b", [{ id: "other", role: "user", content: "Elsewhere", timestamp: at }]),
    ]),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ChatMessages chatId="a" surfaceId="test" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("chat transcript rendering", () => {
  it("re-renders only the message a streamed token lands in", async () => {
    expect(renders.get("prompt")).toBe(1);
    await act(async () => {
      useAIChatStore.getState().actions.updateMessage("a", "reply", { content: "Hel" });
    });
    await act(async () => {
      useAIChatStore.getState().actions.updateMessage("a", "reply", { content: "Hello" });
    });
    expect(container.textContent).toContain("Hello");
    expect(renders.get("prompt")).toBe(1);
    expect(renders.get("reply")).toBe(3);
  });

  it("keeps the timeline while a reply streams and rebuilds it for a new message", async () => {
    const builds = timelineBuilds.count;
    await act(async () => {
      useAIChatStore.getState().actions.updateMessage("a", "reply", { content: "Hel" });
    });
    expect(timelineBuilds.count).toBe(builds);

    await act(async () => {
      useAIChatStore.getState().actions.addMessage("a", {
        id: "next",
        role: "user",
        content: "More",
        timestamp: at,
      });
    });
    expect(timelineBuilds.count).toBe(builds + 1);
    expect(container.textContent).toContain("More");
    expect(renders.get("prompt")).toBe(1);
  });

  it("ignores updates to other chats", async () => {
    await act(async () => {
      useAIChatStore.getState().actions.updateMessage("b", "other", { content: "Changed" });
    });
    expect(renders.get("prompt")).toBe(1);
    expect(renders.get("reply")).toBe(1);
  });
});
