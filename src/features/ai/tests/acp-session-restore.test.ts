import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

const { actions } = vi.hoisted(() => ({
  actions: {
    getChatById: vi.fn(() => ({ id: "chat-1", agentId: "codex", acpSessionId: "earlier" })),
    getCurrentChat: vi.fn(),
    setAcpAgentStatus: vi.fn(),
    setChatAcpSessionId: vi.fn(),
  },
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: { getState: vi.fn(() => ({ acpAgents: {}, actions })) },
}));

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { mcpServers: [] } }) },
}));

vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: vi.fn(() => ({ rootFolderPath: "/workspace" })) },
}));

function answerOpen(opened: { sessionId: string; contextLost?: boolean }) {
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "open_acp_session") return undefined;
    return {
      ...opened,
      status: {
        running: true,
        initialized: true,
        agentId: "codex",
        workspacePath: "/workspace",
        sessionIds: [opened.sessionId],
      },
    };
  });
}

async function openChatSession() {
  const handler = new AcpStreamHandler(
    "codex",
    { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
    "chat-1",
  ) as unknown as { ensureSession: () => Promise<void> };
  await handler.ensureSession();
}

describe("reopening a chat's ACP session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("asks the bridge for the chat's earlier session", async () => {
    answerOpen({ sessionId: "earlier" });
    await openChatSession();

    expect(invoke).toHaveBeenCalledWith(
      "open_acp_session",
      expect.objectContaining({ agentId: "codex", sessionId: "earlier" }),
    );
    expect(actions.setChatAcpSessionId).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("moves the chat to the new session and says the agent lost its context", async () => {
    answerOpen({ sessionId: "fresh", contextLost: true });
    await openChatSession();

    expect(actions.setChatAcpSessionId).toHaveBeenCalledWith("chat-1", "fresh");
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.warning).mock.calls[0][0]).toContain(
      "could not restore this chat's earlier session",
    );
  });
});
