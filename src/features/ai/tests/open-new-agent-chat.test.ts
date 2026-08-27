import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";

const mocks = vi.hoisted(() => ({
  currentAgentId: "custom",
  createNewChat: vi.fn(() => "chat-1"),
  setPendingAgentLaunchRequest: vi.fn(),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
  openTerminalAgent: vi.fn(() => "terminal://claude"),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: () => ({
      actions: {
        getCurrentAgentId: () => mocks.currentAgentId,
        createNewChat: mocks.createNewChat,
        setPendingAgentLaunchRequest: mocks.setPendingAgentLaunchRequest,
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

  it("opens a new chat with editor selection context without submitting a prompt", () => {
    const editorSelection = {
      id: "selection-1",
      bufferId: "buffer-1",
      filePath: "/workspace/src/app.ts",
      fileName: "app.ts",
      languageId: "typescript",
      selectedText: "const answer = 42;",
      startLine: 4,
      startColumn: 1,
      endLine: 4,
      endColumn: 19,
    };

    openNewAgentChat(undefined, { editorSelections: [editorSelection] });

    expect(mocks.setPendingAgentLaunchRequest).toHaveBeenCalledWith({
      chatId: "chat-1",
      agentId: "custom",
      prompt: null,
      selectedBufferIds: [],
      selectedFilesPaths: [],
      editorSelections: [editorSelection],
    });
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
  });

  it("uses a context-capable chat when the current agent only runs in a terminal", () => {
    mocks.currentAgentId = "claude-code";
    const editorSelection = {
      id: "selection-1",
      bufferId: "buffer-1",
      filePath: "/workspace/src/app.ts",
      fileName: "app.ts",
      languageId: "typescript",
      selectedText: "const answer = 42;",
      startLine: 4,
      startColumn: 1,
      endLine: 4,
      endColumn: 19,
    };

    openNewAgentChat(undefined, { editorSelections: [editorSelection] });

    expect(mocks.openTerminalAgent).not.toHaveBeenCalled();
    expect(mocks.createNewChat).toHaveBeenCalledWith("custom", { activate: false });
  });
});
