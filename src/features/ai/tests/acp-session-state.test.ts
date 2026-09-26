import { describe, expect, it } from "vite-plus/test";
import {
  EMPTY_ACP_SESSION_STATE,
  getAcpAgentKey,
  getChatAcpSessionToClose,
  selectAcpAgentStatus,
  selectChatAcpSession,
} from "@/features/ai/lib/acp-session-state";
import type { AcpSessionState } from "@/features/ai/types/acp.types";
import type { Chat } from "@/features/ai/types/ai-chat.types";

const chat = (id: string, agentId: string, acpSessionId: string | null) =>
  ({ id, agentId, acpSessionId }) as Chat;

describe("ACP session state", () => {
  it("keys one agent process per agent and workspace", () => {
    expect(getAcpAgentKey("gemini", "/work/")).toBe(getAcpAgentKey("gemini", "/work"));
    expect(getAcpAgentKey("gemini", "/work")).not.toBe(getAcpAgentKey("claude-acp", "/work"));
    expect(getAcpAgentKey("gemini", "/work")).not.toBe(getAcpAgentKey("gemini", "/other"));
  });

  it("finds the running agent for a chat's agent and workspace", () => {
    const status = { agentId: "gemini", running: true, initialized: true, workspacePath: "/w" };
    const state = { acpAgents: { [getAcpAgentKey("gemini", "/w")]: status } };
    expect(selectAcpAgentStatus(state, "gemini", "/w")).toBe(status);
    expect(selectAcpAgentStatus(state, "claude-acp", "/w")).toBeNull();
  });

  it("gives each chat the modes and commands of its own session", () => {
    const sessionA: AcpSessionState = {
      slashCommands: [{ name: "review", description: "Review" }],
      modeState: { currentModeId: "plan", availableModes: [] },
      configOptions: [],
      usage: null,
    };
    const state = {
      chats: [chat("chat-1", "gemini", "session-a"), chat("chat-2", "gemini", "session-b")],
      acpAgents: {},
      acpSessions: { "session-a": sessionA },
    };
    expect(selectChatAcpSession(state, "chat-1")).toBe(sessionA);
    expect(selectChatAcpSession(state, "chat-2")).toBe(EMPTY_ACP_SESSION_STATE);
    expect(selectChatAcpSession(state, null)).toBe(EMPTY_ACP_SESSION_STATE);
  });

  it("closes the ACP session of a deleted agent chat only", () => {
    expect(getChatAcpSessionToClose(chat("c", "gemini", "session-a"))).toBe("session-a");
    expect(getChatAcpSessionToClose(chat("c", "codex", "thread-1"))).toBeNull();
    expect(getChatAcpSessionToClose(chat("c", "custom", null))).toBeNull();
    expect(getChatAcpSessionToClose(chat("c", "gemini", null))).toBeNull();
    expect(getChatAcpSessionToClose(undefined)).toBeNull();
  });
});
