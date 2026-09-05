import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { CodexIntegrationService } from "@/features/ai/integrations/codex/codex-integration-service";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  openPullRequest: vi.fn(() => "pull-request://73"),
  openIssue: vi.fn(() => "github-issue://735"),
  updateChatTitle: vi.fn(),
  getChatById: vi.fn(() => ({ id: "chat-1" })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: vi.fn(() => ({
      actions: {
        getChatById: mocks.getChatById,
        setChatAcpSessionId: vi.fn(),
        updateChatTitle: mocks.updateChatTitle,
      },
    })),
  },
}));

vi.mock("@/features/editor/stores/buffer.store", () => ({
  useBufferStore: {
    getState: vi.fn(() => ({
      actions: {
        openPRBuffer: mocks.openPullRequest,
        openGitHubIssueBuffer: mocks.openIssue,
      },
    })),
  },
}));

describe("Codex integration service", () => {
  it("sends pasted image data URLs as Codex turn input items", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "start_codex_thread") return { thread: { id: "thread-1" } };
      if (command === "start_codex_turn") return { turn: { id: "turn-1" } };
      return undefined;
    });
    vi.mocked(listen).mockResolvedValue(vi.fn());
    const onError = vi.fn();
    const service = new CodexIntegrationService(
      { onChunk: vi.fn(), onComplete: vi.fn(), onError },
      "chat-1",
    );
    try {
      await service.start("", { images: [{ mediaType: "image/png", data: "YWJj" }] });
      expect(onError).not.toHaveBeenCalled();
      expect(invoke).toHaveBeenCalledWith("start_codex_turn", {
        args: expect.objectContaining({
          input: [{ type: "image", url: "data:image/png;base64,YWJj" }],
        }),
      });
    } finally {
      await CodexIntegrationService.cancel();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens native pull request tabs and resolves the dynamic tool call", () => {
    const service = new CodexIntegrationService({
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }) as unknown as {
      projectRoot: string;
      threadId: string;
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };
    service.projectRoot = "/workspace/athas";
    service.threadId = "thread-1";

    service.handleEvent({
      method: "item/tool/call",
      id: 91,
      params: {
        threadId: "thread-1",
        tool: "athas_open_pull_request",
        arguments: { number: 73, title: "Native PR tabs" },
      },
    });

    expect(useBufferStore.getState().actions.openPRBuffer).toHaveBeenCalledWith(73, {
      repoPath: "/workspace/athas",
      title: "Native PR tabs",
      initialView: "activity",
    });
    expect(invoke).toHaveBeenCalledWith("respond_codex_request", {
      response: {
        requestId: 91,
        decision: {
          contentItems: [{ type: "inputText", text: "Pull request #73 opened in Athas." }],
          success: true,
        },
      },
    });
  });

  it("opens native issue tabs and resolves the dynamic tool call", () => {
    const service = new CodexIntegrationService({
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    }) as unknown as {
      projectRoot: string;
      threadId: string;
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };
    service.projectRoot = "/workspace/athas";
    service.threadId = "thread-1";

    service.handleEvent({
      method: "item/tool/call",
      id: 92,
      params: {
        threadId: "thread-1",
        tool: "athas_open_issue",
        arguments: { number: 735, title: "Test issue" },
      },
    });

    expect(useBufferStore.getState().actions.openGitHubIssueBuffer).toHaveBeenCalledWith({
      issueNumber: 735,
      repoPath: "/workspace/athas",
      title: "Test issue",
    });
    expect(invoke).toHaveBeenCalledWith("respond_codex_request", {
      response: {
        requestId: 92,
        decision: {
          contentItems: [{ type: "inputText", text: "Issue #735 opened in Athas." }],
          success: true,
        },
      },
    });
  });

  it("renames only the Codex service's Athas chat", () => {
    const service = new CodexIntegrationService(
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      "chat-1",
    ) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "item/tool/call",
      id: 93,
      params: {
        threadId: "thread-1",
        tool: "athas_set_chat_title",
        arguments: { title: "Native GitHub Tabs" },
      },
    });

    expect(mocks.updateChatTitle).toHaveBeenCalledWith("chat-1", "Native GitHub Tabs");
    expect(invoke).toHaveBeenCalledWith("respond_codex_request", {
      response: {
        requestId: 93,
        decision: {
          contentItems: [
            { type: "inputText", text: 'Athas chat renamed to "Native GitHub Tabs".' },
          ],
          success: true,
        },
      },
    });
  });

  it("syncs Codex thread names to the matching Athas chat", () => {
    const service = new CodexIntegrationService(
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      "chat-1",
    ) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "thread/name/updated",
      params: { threadId: "thread-1", threadName: "Native GitHub tabs" },
    });

    expect(mocks.updateChatTitle).toHaveBeenCalledWith("chat-1", "Native GitHub tabs");
  });

  it("ignores thread names from another Codex session", () => {
    const service = new CodexIntegrationService(
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      "chat-1",
    ) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "thread/name/updated",
      params: { threadId: "thread-2", threadName: "Wrong session" },
    });

    expect(mocks.updateChatTitle).not.toHaveBeenCalled();
  });

  it("ignores transcript items and continues the response after tool activity", () => {
    const calls: string[] = [];
    const onToolUse = vi.fn(() => calls.push("tool-start"));
    const onToolComplete = vi.fn(() => calls.push("tool-complete"));
    const onResponseContinuation = vi.fn(() => calls.push("response-continuation"));
    const onChunk = vi.fn(() => calls.push("chunk"));
    const service = new CodexIntegrationService({
      onChunk,
      onComplete: vi.fn(),
      onError: vi.fn(),
      onResponseContinuation,
      onToolUse,
      onToolComplete,
    }) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "item/started",
      params: { threadId: "thread-1", item: { id: "user-1", type: "userMessage" } },
    });
    service.handleEvent({
      method: "item/completed",
      params: { threadId: "thread-1", item: { id: "user-1", type: "userMessage" } },
    });

    expect(onToolUse).not.toHaveBeenCalled();
    expect(onToolComplete).not.toHaveBeenCalled();

    service.handleEvent({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: {
          id: "tool-1",
          type: "dynamicToolCall",
          tool: "athas_set_chat_title",
        },
      },
    });
    service.handleEvent({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        item: {
          id: "tool-1",
          type: "dynamicToolCall",
          tool: "athas_set_chat_title",
        },
      },
    });
    service.handleEvent({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", delta: "Done" },
    });

    expect(onToolUse).toHaveBeenCalledWith(
      expect.objectContaining({ toolId: "tool-1", toolName: "athas_set_chat_title" }),
    );
    expect(calls).toEqual(["tool-start", "tool-complete", "response-continuation", "chunk"]);
  });

  it("surfaces Codex reasoning only after a real reasoning item starts", () => {
    const onEvent = vi.fn();
    const service = new CodexIntegrationService({
      onChunk: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
      onEvent,
    }) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "item/started",
      params: {
        threadId: "thread-1",
        item: { id: "reasoning-1", type: "reasoning" },
      },
    });

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "thought_chunk", sessionId: "thread-1" }),
    );
  });

  it("distinguishes cancelled Codex turns from completed work", () => {
    const onComplete = vi.fn();
    const service = new CodexIntegrationService({
      onChunk: vi.fn(),
      onComplete,
      onError: vi.fn(),
    }) as unknown as {
      threadId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";

    service.handleEvent({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { status: "cancelled" } },
    });

    expect(onComplete).toHaveBeenCalledWith({ outcome: "cancelled" });
  });

  it("ignores message and reasoning events from another Codex thread", () => {
    const onChunk = vi.fn();
    const onEvent = vi.fn();
    const service = new CodexIntegrationService({
      onChunk,
      onComplete: vi.fn(),
      onError: vi.fn(),
      onEvent,
    }) as unknown as {
      threadId: string;
      turnId: string;
      handleEvent: (event: { method: string; params: Record<string, unknown> }) => void;
    };
    service.threadId = "thread-1";
    service.turnId = "turn-1";

    service.handleEvent({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-2", turnId: "turn-2", delta: "wrong chat" },
    });
    service.handleEvent({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-2",
        item: { id: "reasoning-2", type: "reasoning" },
      },
    });

    expect(onChunk).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
