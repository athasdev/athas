import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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

type TestableAcpStreamHandler = {
  handleAcpEvent: (event: unknown) => void;
};

const handleAcpEvent = (handler: AcpStreamHandler, event: AcpEvent) => {
  (handler as unknown as TestableAcpStreamHandler).handleAcpEvent(event);
};

describe("AcpStreamHandler usage updates", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes usage updates through the generic ACP event stream without mutating chat output", () => {
    const onEvent = vi.fn();
    const onChunk = vi.fn();
    const onToolUse = vi.fn();
    const onToolComplete = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();
    const handler = new AcpStreamHandler(
      "codex",
      {
        onChunk,
        onComplete,
        onError,
        onEvent,
        onToolUse,
        onToolComplete,
      },
      "chat-1",
    );
    const event: AcpEvent = {
      type: "usage_update",
      sessionId: "session-1",
      used: 1234,
      size: 200000,
    };

    handleAcpEvent(handler, event);

    expect(onEvent).toHaveBeenCalledWith(event);
    expect(onChunk).not.toHaveBeenCalled();
    expect(onToolUse).not.toHaveBeenCalled();
    expect(onToolComplete).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
