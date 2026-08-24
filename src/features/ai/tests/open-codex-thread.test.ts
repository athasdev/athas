import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openCodexThread } from "@/features/ai/lib/open-codex-thread";

const mocks = vi.hoisted(() => ({
  chats: [] as Array<{ id: string; agentId: string; acpSessionId: string | null }>,
  createNewChat: vi.fn(() => "chat-1"),
  setChatAcpSessionId: vi.fn(),
  updateChatTitle: vi.fn(),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      chats: mocks.chats,
      actions: {
        createNewChat: mocks.createNewChat,
        setChatAcpSessionId: mocks.setChatAcpSessionId,
        updateChatTitle: mocks.updateChatTitle,
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
  });

  it("creates an Athas chat bound to the selected Codex thread", () => {
    expect(openCodexThread(thread)).toBe("agent://chat-1");
    expect(mocks.createNewChat).toHaveBeenCalledWith("codex", { activate: false });
    expect(mocks.setChatAcpSessionId).toHaveBeenCalledWith("chat-1", "thread-1");
    expect(mocks.updateChatTitle).toHaveBeenCalledWith("chat-1", "Session menu");
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
  });

  it("reopens an existing Athas chat for the Codex thread", () => {
    mocks.chats = [{ id: "chat-existing", agentId: "codex", acpSessionId: "thread-1" }];

    openCodexThread(thread);

    expect(mocks.createNewChat).not.toHaveBeenCalled();
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-existing");
  });
});
