import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { openNewAgentChat } from "@/features/ai/lib/open-new-agent-chat";

const mocks = vi.hoisted(() => ({
  currentAgentId: "custom",
  createNewChat: vi.fn(() => "chat-1"),
  setPendingAgentLaunchRequest: vi.fn(),
  openAgentBuffer: vi.fn(() => "agent://chat-1"),
  openTerminalBuffer: vi.fn(() => "terminal://claude"),
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
    getState: () => ({
      actions: {
        openAgentBuffer: mocks.openAgentBuffer,
        openTerminalBuffer: mocks.openTerminalBuffer,
      },
    }),
  },
}));

describe("open new agent chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentAgentId = "custom";
  });

  it("creates and opens a new editor-tab chat immediately", () => {
    const bufferId = openNewAgentChat();

    expect(mocks.createNewChat).toHaveBeenCalledWith("custom", {
      activate: false,
      reuseEmpty: true,
    });
    expect(mocks.openAgentBuffer).toHaveBeenCalledWith("chat-1");
    expect(bufferId).toBe("agent://chat-1");
  });

  it("uses an explicit agent without replacing the sidebar session", () => {
    openNewAgentChat("codex");

    expect(mocks.createNewChat).toHaveBeenCalledWith("codex", {
      activate: false,
      reuseEmpty: true,
    });
  });

  it.each([
    ["claude-code", "claude-acp"],
    ["antigravity-cli", "antigravity-acp"],
    ["claude-acp", "claude-acp"],
    ["gemini-cli", "gemini-cli"],
  ])("opens %s as a %s chat instead of a terminal", (agentId, chatAgentId) => {
    const bufferId = openNewAgentChat(agentId);

    expect(mocks.openTerminalBuffer).not.toHaveBeenCalled();
    expect(mocks.createNewChat).toHaveBeenCalledWith(chatAgentId, {
      activate: false,
      reuseEmpty: true,
    });
    expect(bufferId).toBe("agent://chat-1");
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

  it("keeps editor selections with a former terminal agent, now an ACP chat", () => {
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

    expect(mocks.openTerminalBuffer).not.toHaveBeenCalled();
    // A launch request carries its own prompt, so it must not land in a
    // session the user already has open.
    expect(mocks.createNewChat).toHaveBeenCalledWith("claude-acp", {
      activate: false,
      reuseEmpty: false,
    });
  });
});
