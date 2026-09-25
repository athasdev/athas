import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { toast } from "sonner";
import { canLogOutOfAcpAgent, logOutOfAcpAgent } from "@/features/ai/lib/acp-logout";
import { AcpStreamHandler } from "@/features/ai/services/acp-stream-handler";
import { useAcpAuthStore } from "@/features/ai/stores/acp-auth.store";
import type { AcpAgentStatus } from "@/features/ai/types/acp.types";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/ai/services/acp-stream-handler", () => ({
  AcpStreamHandler: { logoutAgent: vi.fn() },
}));

function status(authCapabilities: unknown, running = true): AcpAgentStatus {
  return {
    agentId: "gemini",
    running,
    sessionActive: running,
    initialized: running,
    agentCapabilities: {
      loadSession: false,
      promptCapabilities: { image: false, audio: false, embeddedContext: false },
      mcpCapabilities: { http: false, sse: false },
      sessionCapabilities: {},
      authCapabilities,
    },
  };
}

describe("agent logout", () => {
  beforeEach(() => {
    vi.mocked(AcpStreamHandler.logoutAgent).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("is offered only for a running agent that advertises logout", () => {
    expect(canLogOutOfAcpAgent(status({ logout: {} }))).toBe(true);
    expect(canLogOutOfAcpAgent(status({ logout: {} }), "gemini")).toBe(true);
    expect(canLogOutOfAcpAgent(status({ logout: {} }), "claude-acp")).toBe(false);
    expect(canLogOutOfAcpAgent(status({}))).toBe(false);
    expect(canLogOutOfAcpAgent(status({ logout: null }))).toBe(false);
    expect(canLogOutOfAcpAgent(status({ logout: {} }, false))).toBe(false);
    expect(canLogOutOfAcpAgent(null)).toBe(false);
  });

  it("drops a pending sign-in choice once logged out", async () => {
    useAcpAuthStore.getState().actions.require({
      agentId: "gemini",
      sessionId: null,
      methods: [{ id: "oauth", name: "OAuth", description: null, kind: "agent", terminal: null }],
    });

    await logOutOfAcpAgent();

    expect(AcpStreamHandler.logoutAgent).toHaveBeenCalled();
    expect(useAcpAuthStore.getState().request).toBeNull();
    expect(toast.success).toHaveBeenCalled();
  });

  it("reports a failed logout instead of throwing", async () => {
    vi.mocked(AcpStreamHandler.logoutAgent).mockRejectedValue(new Error("No active connection"));

    await expect(logOutOfAcpAgent()).resolves.toBeUndefined();
    expect(toast.error).toHaveBeenCalledWith("Couldn't log out of the agent", {
      description: "No active connection",
    });
  });
});
