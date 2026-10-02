// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invoke } from "@tauri-apps/api/core";
import { loadAllChatsFromDb, loadChatFromDb } from "@/features/ai/services/ai-chat-history-service";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
  getAllWebviewWindows: async () => [],
}));

const SETTINGS_KEY = "athas-ai-chat-settings-v7";

function chatRow(id: string, agentId: string | null) {
  return {
    id,
    title: id,
    created_at: 0,
    last_message_at: 0,
    agent_id: agentId,
    acp_session_id: null,
    workspace_path: null,
    provider_id: null,
    model_id: null,
    branch: null,
    is_pinned: false,
    archived_at: null,
  };
}

describe("former terminal agent ids", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    localStorage.clear();
  });

  it("open saved chats with the ACP agent", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      chatRow("claude", "claude-code"),
      chatRow("antigravity", "antigravity-cli"),
      chatRow("gemini", "gemini-cli"),
      chatRow("api", null),
    ]);

    const chats = await loadAllChatsFromDb();

    expect(chats.map((chat) => chat.agentId)).toEqual([
      "claude-acp",
      "antigravity-acp",
      "gemini-cli",
      "custom",
    ]);
  });

  it("open a single saved chat with the ACP agent", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({
      chat: chatRow("claude", "claude-code"),
      messages: [],
      tool_calls: [],
    });

    expect((await loadChatFromDb("claude"))?.agentId).toBe("claude-acp");
  });

  it("select the ACP agent when the saved selection is a former terminal agent", async () => {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ state: { selectedAgentId: "claude-code" }, version: 3 }),
    );

    await useAIChatStore.persist.rehydrate();

    expect(useAIChatStore.getState().selectedAgentId).toBe("claude-acp");
  });
});
