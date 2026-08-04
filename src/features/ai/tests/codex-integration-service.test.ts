import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
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
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };
    service.projectRoot = "/workspace/athas";

    service.handleEvent({
      method: "item/tool/call",
      id: 91,
      params: {
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
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };
    service.projectRoot = "/workspace/athas";

    service.handleEvent({
      method: "item/tool/call",
      id: 92,
      params: {
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
      handleEvent: (event: { method: string; id: number; params: Record<string, unknown> }) => void;
    };

    service.handleEvent({
      method: "item/tool/call",
      id: 93,
      params: {
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
});
