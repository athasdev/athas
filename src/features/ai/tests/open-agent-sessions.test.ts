import { describe, expect, it } from "vite-plus/test";
import {
  canBrowseAgentSessions,
  canDeleteAgentSessions,
} from "@/features/ai/lib/open-agent-sessions";
import type { AcpAgentStatus } from "@/features/ai/types/acp.types";

function status(sessionCapabilities: unknown, running = true): AcpAgentStatus {
  return {
    agentId: "codex",
    running,
    initialized: running,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      mcpCapabilities: { http: false, sse: false },
      sessionCapabilities,
      authCapabilities: {},
    },
  } as AcpAgentStatus;
}

describe("agent session browsing", () => {
  it("is offered for a running agent that advertises session/list", () => {
    expect(canBrowseAgentSessions(status({ list: {} }), "codex")).toBe(true);
    expect(canBrowseAgentSessions(status({ list: null }), "codex")).toBe(false);
    expect(canBrowseAgentSessions(status({}), "codex")).toBe(false);
  });

  it("is offered for an agent that is not running yet, which the list starts", () => {
    expect(canBrowseAgentSessions(status({}, false), "codex")).toBe(true);
    expect(canBrowseAgentSessions(status({}), "claude-code")).toBe(true);
    expect(canBrowseAgentSessions(null, "codex")).toBe(true);
  });

  it("offers delete only when the agent advertises session/delete", () => {
    expect(canDeleteAgentSessions(status({ list: {}, delete: {} }))).toBe(true);
    expect(canDeleteAgentSessions(status({ list: {} }))).toBe(false);
  });
});
