import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import type { McpServerSetting } from "@/features/ai/types/mcp-server.types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: vi.fn() } }));

const servers: McpServerSetting[] = [
  {
    id: "fs",
    name: "files",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: ["-y", "server"],
    url: "",
  },
  {
    id: "off",
    name: "disabled",
    enabled: false,
    transport: "stdio",
    command: "off",
    args: [],
    url: "",
  },
  {
    id: "linear",
    name: "linear",
    enabled: true,
    transport: "http",
    command: "",
    args: [],
    url: "https://mcp.linear.app/mcp",
  },
];

vi.mock("@/features/settings/stores/settings.store", () => ({
  useSettingsStore: { getState: () => ({ settings: { mcpServers: servers } }) },
}));

vi.mock("@/features/ai/stores/ai-chat.store", () => ({
  useAIChatStore: {
    getState: vi.fn(() => ({
      acpStatus: null,
      actions: {
        getChatById: vi.fn(),
        getCurrentChat: vi.fn(),
        setAcpStatus: vi.fn(),
        setChatAcpSessionId: vi.fn(),
      },
    })),
  },
}));

vi.mock("@/features/window/stores/project.store", () => ({
  useProjectStore: { getState: vi.fn(() => ({ rootFolderPath: "/workspace" })) },
}));

describe("ACP startup with MCP servers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(listen).mockResolvedValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("passes enabled servers and reports the ones the agent skipped once", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === "get_acp_status") {
        return { running: false, initialized: false, agentId: null, sessionId: null };
      }
      if (command === "start_acp_agent") {
        return {
          running: true,
          initialized: true,
          agentId: "gemini",
          sessionId: "session-1",
          workspacePath: "/workspace",
          skippedMcpServers: [{ name: "linear", transport: "http" }],
        };
      }
      return undefined;
    });

    const handler = new AcpStreamHandler(
      "gemini",
      { onChunk: vi.fn(), onComplete: vi.fn(), onError: vi.fn() },
      "chat-1",
    ) as unknown as { ensureAgentRunning: () => Promise<void> };
    const startup = handler.ensureAgentRunning();
    await vi.advanceTimersByTimeAsync(1000);
    await startup;

    const startCalls = vi.mocked(invoke).mock.calls.filter(([name]) => name === "start_acp_agent");
    expect(startCalls).toHaveLength(1);
    expect(startCalls[0][1]).toMatchObject({
      agentId: "gemini",
      mcpServers: [servers[0], servers[2]],
    });
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.warning).toHaveBeenCalledWith(
      "gemini cannot use these MCP servers, so they were not passed to it: linear (HTTP).",
    );
  });
});
