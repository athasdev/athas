import { describe, expect, it } from "vite-plus/test";
import { getAgentMessageAccess } from "@/features/ai/lib/agent-message-access";

describe("agent message access", () => {
  it("allows Codex and ACP agents without a custom provider key", () => {
    expect(getAgentMessageAccess("codex", false).accepted).toBe(true);
    expect(getAgentMessageAccess("opencode", false).accepted).toBe(true);
  });

  it("requires a key only for the custom provider", () => {
    expect(getAgentMessageAccess("custom", false)).toMatchObject({ accepted: false });
    expect(getAgentMessageAccess("custom", true)).toEqual({ accepted: true });
  });
});
