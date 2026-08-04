import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openAgentHistoryChat } from "@/features/ai/lib/open-agent-history";

const mocks = vi.hoisted(() => ({
  chat: {
    id: "chat-1",
    messages: [] as Array<{ id: string }>,
  },
  pendingAgentLaunchRequest: null as { chatId: string } | null,
  loadChatMessages: vi.fn(() => Promise.resolve()),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: vi.fn(() => ({
      pendingAgentLaunchRequest: mocks.pendingAgentLaunchRequest,
      actions: {
        getChatById: vi.fn(() => mocks.chat),
        loadChatMessages: mocks.loadChatMessages,
      },
    })),
  },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: vi.fn(() => ({
      actions: { openAgentBuffer: mocks.openAgentBuffer },
    })),
  },
}));

describe("open agent history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chat.messages = [];
    mocks.pendingAgentLaunchRequest = null;
  });

  it("hydrates persisted messages before opening a history tab", () => {
    const bufferId = openAgentHistoryChat("chat-1");

    expect(mocks.loadChatMessages).toHaveBeenCalledWith("chat-1");
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
    expect(bufferId).toBe("agent://chat-1");
  });

  it("does not reload an active in-memory conversation", () => {
    mocks.chat.messages = [{ id: "message-1" }];

    openAgentHistoryChat("chat-1");

    expect(mocks.loadChatMessages).not.toHaveBeenCalled();
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
  });

  it("does not race a newly launched agent session", () => {
    mocks.pendingAgentLaunchRequest = { chatId: "chat-1" };

    openAgentHistoryChat("chat-1");

    expect(mocks.loadChatMessages).not.toHaveBeenCalled();
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
  });
});
