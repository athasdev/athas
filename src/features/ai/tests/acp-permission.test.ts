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

type TestableAcpStreamHandler = {
  handleAcpEvent: (event: unknown) => void;
};

const mockedInvoke = vi.mocked(invoke);

const handleAcpEvent = (handler: AcpStreamHandler, event: AcpEvent) => {
  (handler as unknown as TestableAcpStreamHandler).handleAcpEvent(event);
};

const permissionEvent: AcpEvent = {
  type: "permission_request",
  requestId: "request-1",
  permissionType: "tool_call",
  resource: "tool-1",
  description: "Run command (tool-1)",
  options: [
    {
      id: "allow-once",
      name: "Allow once",
      kind: "allow_once",
    },
    {
      id: "reject-once",
      name: "Reject once",
      kind: "reject_once",
    },
  ],
};

describe("AcpStreamHandler permission requests", () => {
  afterEach(() => {
    mockedInvoke.mockReset();
    vi.clearAllMocks();
  });

  it("routes permission requests to the permission handler", () => {
    const onEvent = vi.fn();
    const onPermissionRequest = vi.fn();
    const handler = new AcpStreamHandler(
      "codex",
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
        onEvent,
        onPermissionRequest,
      },
      "chat-1",
    );

    handleAcpEvent(handler, permissionEvent);

    expect(onEvent).toHaveBeenCalledWith(permissionEvent);
    expect(onPermissionRequest).toHaveBeenCalledWith(permissionEvent);
    expect(mockedInvoke).not.toHaveBeenCalled();
  });

  it("auto-rejects permission requests when no permission handler is registered", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const handler = new AcpStreamHandler(
      "codex",
      {
        onChunk: vi.fn(),
        onComplete: vi.fn(),
        onError: vi.fn(),
      },
      "chat-1",
    );

    handleAcpEvent(handler, permissionEvent);
    await vi.waitFor(() => {
      expect(mockedInvoke).toHaveBeenCalledWith("respond_acp_permission", {
        args: {
          requestId: "request-1",
          approved: false,
          cancelled: false,
          optionId: undefined,
        },
      });
    });
  });
});
