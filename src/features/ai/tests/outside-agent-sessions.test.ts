import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/ai/services/acp-stream-handler", () => ({ AcpStreamHandler: {} }));
vi.mock("@/features/ai/lib/import-agent-session", () => ({ importAgentSession: vi.fn() }));
vi.mock("@/features/ai/services/open-agent-history", () => ({ openAgentHistoryChat: vi.fn() }));
vi.mock("@/features/ai/stores/ai-chat.store", () => ({ useAIChatStore: { getState: vi.fn() } }));

import {
  type OutsideAgentSession,
  withoutHeldSessions,
} from "@/features/ai/services/outside-agent-sessions";

const outside = (agentId: string, sessionId: string): OutsideAgentSession => ({
  agentId,
  sessionId,
  title: sessionId,
  updatedAt: new Date(0),
});

describe("outside agent sessions", () => {
  it("leaves out sessions a chat already holds, including chats with a legacy agent id", () => {
    const sessions = [
      outside("claude-acp", "held-by-legacy"),
      outside("claude-acp", "free"),
      outside("codex", "held"),
      outside("codex", "same-id-other-agent"),
    ];

    const remaining = withoutHeldSessions(sessions, [
      { agentId: "claude-code", acpSessionId: "held-by-legacy" },
      { agentId: "codex", acpSessionId: "held" },
      { agentId: "claude-acp", acpSessionId: "same-id-other-agent" },
      { agentId: "codex", acpSessionId: null },
    ]);

    expect(remaining.map((session) => `${session.agentId}:${session.sessionId}`)).toEqual([
      "claude-acp:free",
      "codex:same-id-other-agent",
    ]);
  });
});
