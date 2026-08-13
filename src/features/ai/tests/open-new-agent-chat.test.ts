import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";

const mocks = vi.hoisted(() => ({
  currentAgentId: "custom",
  createNewChat: vi.fn(() => "chat-1"),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
  openTerminalAgent: vi.fn(() => "terminal://claude"),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      actions: {
        getCurrentAgentId: () => mocks.currentAgentId,
        createNewChat: mocks.createNewChat,
      },
    }),
  },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: () => ({ actions: { openAgentBuffer: mocks.openAgentBuffer } }),
  },
}));

vi.mock("@/features/ai/lib/terminal-agents", () => ({
  isTerminalAgent: (agentId: string) => agentId === "claude-code",
}));

vi.mock("@/features/ai/lib/terminal-agent-terminal", () => ({
  openTerminalAgent: mocks.openTerminalAgent,
}));

describe("open new agent chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAgentId = "custom";
  });

  it("creates and opens a new editor-tab chat immediately", () => {
    const bufferId = openNewAgentChat();

    expect(mocks.createNewChat).toHaveBeenCalledWith("custom", { activate: false });
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
    expect(bufferId).toBe("agent://chat-1");
  });

  it("uses an explicit agent without replacing the sidebar session", () => {
    openNewAgentChat("codex");

    expect(mocks.createNewChat).toHaveBeenCalledWith("codex", { activate: false });
  });

  it("opens terminal agents without creating a chat", () => {
    const bufferId = openNewAgentChat("claude-code");

    expect(mocks.openTerminalAgent).toHaveBeenCalledWith("claude-code");
    expect(mocks.createNewChat).not.toHaveBeenCalled();
    expect(bufferId).toBe("terminal://claude");
  });
});
