import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { AcpStreamHandler } from "../services/acp-stream-handler";
import type { AcpEvent } from "../types/acp";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@/features/ai/store/store", () => ({
  useAIChatStore: {
    getState: () => ({
      acpStatus: null,
      getChatById: () => null,
      getCurrentChat: () => null,
      setAcpStatus: vi.fn(),
      setChatAcpSessionId: vi.fn(),
      setAvailableSlashCommands: vi.fn(),
      setSessionConfigOptions: vi.fn(),
      setSessionModeState: vi.fn(),
      setCurrentModeId: vi.fn(),
    }),
  },
}));

vi.mock("@/features/editor/stores/buffer-store", () => ({
  useBufferStore: {
    getState: () => ({
      actions: {
        openWebViewerBuffer: vi.fn(),
        openTerminalBuffer: vi.fn(),
      },
    }),
  },
}));

vi.mock("@/features/window/stores/project-store", () => ({
  useProjectStore: {
    getState: () => ({
      rootFolderPath: "/repo",
    }),
  },
}));

vi.mock("@/features/ai/lib/acp-session-info", () => ({
  getChatTitleFromSessionInfo: (_currentTitle: string | undefined, nextTitle: string) => nextTitle,
}));

vi.mock("../utils/ai-context-builder", () => ({
  buildContextPrompt: () => "",
}));

const mockedInvoke = vi.mocked(invoke);

type TestableAcpStreamHandler = {
  handleAcpEvent: (event: unknown) => void;
};

type AcpStreamHandlerStatic = {
  activeHandler: AcpStreamHandler | null;
};

const setActiveHandler = (handler: AcpStreamHandler | null) => {
  (AcpStreamHandler as unknown as AcpStreamHandlerStatic).activeHandler = handler;
};

const handleAcpEvent = (handler: AcpStreamHandler, event: AcpEvent) => {
  (handler as unknown as TestableAcpStreamHandler).handleAcpEvent(event);
};

describe("AcpStreamHandler cancellation", () => {
  afterEach(() => {
    mockedInvoke.mockReset();
    setActiveHandler(null);
  });

  it("finalizes active tools before sending backend cancellation", async () => {
    const onComplete = vi.fn();
    const onToolComplete = vi.fn();
    const handler = new AcpStreamHandler(
      "codex",
      {
        onChunk: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onToolComplete,
      },
      "chat-1",
    );

    handleAcpEvent(handler, {
      type: "tool_start",
      sessionId: "session-1",
      toolName: "read_text_file",
      toolId: "tool-1",
      input: { path: "src/main.ts" },
      kind: "read",
      status: "in_progress",
      locations: [],
    });
    setActiveHandler(handler);

    await AcpStreamHandler.cancelPrompt();

    expect(onToolComplete).toHaveBeenCalledWith("read_text_file", "tool-1", undefined, "Cancelled");
    expect(onComplete).toHaveBeenCalledOnce();
    expect(mockedInvoke).toHaveBeenCalledWith("cancel_acp_prompt");
  });

  it("ignores late events after a cancelled turn is force-stopped", async () => {
    const onComplete = vi.fn();
    const onToolComplete = vi.fn();
    const onToolUse = vi.fn();
    const handler = new AcpStreamHandler(
      "codex",
      {
        onChunk: vi.fn(),
        onComplete,
        onError: vi.fn(),
        onToolUse,
        onToolComplete,
      },
      "chat-1",
    );

    handleAcpEvent(handler, {
      type: "tool_start",
      sessionId: "session-1",
      toolName: "read_text_file",
      toolId: "tool-1",
      input: { path: "src/main.ts" },
      kind: "read",
      status: "in_progress",
      locations: [],
    });
    setActiveHandler(handler);

    await AcpStreamHandler.cancelPrompt();
    handleAcpEvent(handler, {
      type: "tool_start",
      sessionId: "session-1",
      toolName: "write_text_file",
      toolId: "tool-2",
      input: { path: "src/main.ts" },
      kind: "edit",
      status: "in_progress",
      locations: [],
    });

    expect(onToolUse).toHaveBeenCalledOnce();
    expect(onToolComplete).toHaveBeenCalledOnce();
  });
});
