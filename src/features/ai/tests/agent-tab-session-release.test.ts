import { describe, expect, it } from "vite-plus/test";
import { getSessionToCloseWithTab } from "@/features/ai/lib/agent-tab-session-release";
import type { AcpAgentStatus } from "@/features/ai/types/acp.types";

function agent(sessionCapabilities: Record<string, unknown>, loadSession = false): AcpAgentStatus {
  return {
    agentId: "gemini",
    running: true,
    initialized: true,
    sessionIds: ["session-1"],
    agentCapabilities: { loadSession, sessionCapabilities },
  } as AcpAgentStatus;
}

const chat = { agentId: "gemini" as const, acpSessionId: "session-1" };

describe("closing a chat's session with its tab", () => {
  it("closes it when the agent closes sessions and can bring them back", () => {
    expect(
      getSessionToCloseWithTab({ chat, agents: [agent({ close: {} }, true)], isBusy: false }),
    ).toBe("session-1");
    expect(
      getSessionToCloseWithTab({
        chat,
        agents: [agent({ close: {}, resume: {} })],
        isBusy: false,
      }),
    ).toBe("session-1");
  });

  it("keeps it when closing would lose it or it is still in use", () => {
    expect(
      getSessionToCloseWithTab({ chat, agents: [agent({ close: {} })], isBusy: false }),
    ).toBeNull();
    expect(getSessionToCloseWithTab({ chat, agents: [agent({}, true)], isBusy: false })).toBeNull();
    expect(
      getSessionToCloseWithTab({ chat, agents: [agent({ close: {} }, true)], isBusy: true }),
    ).toBeNull();
    expect(getSessionToCloseWithTab({ chat, agents: [], isBusy: false })).toBeNull();
    expect(
      getSessionToCloseWithTab({
        chat: { agentId: "custom", acpSessionId: "session-1" },
        agents: [agent({ close: {} }, true)],
        isBusy: false,
      }),
    ).toBeNull();
  });
});
