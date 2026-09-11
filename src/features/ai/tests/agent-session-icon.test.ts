import { describe, expect, it } from "vite-plus/test";
import { resolveAgentSessionIconId } from "@/features/ai/lib/agent-session-icon";

describe("agent session icon", () => {
  it("uses the agent's own mark for agent-backed sessions", () => {
    expect(resolveAgentSessionIconId({ agentId: "gemini-cli" })).toBe("gemini-cli");
    expect(resolveAgentSessionIconId({ agentId: "codex", providerId: "openai" })).toBe("codex");
  });

  it("falls back to the provider for built-in chat sessions", () => {
    expect(resolveAgentSessionIconId({ agentId: "custom", providerId: "anthropic" })).toBe(
      "anthropic",
    );
  });

  it("uses the caller's current provider when the session stored none", () => {
    expect(resolveAgentSessionIconId({ agentId: "custom", providerId: null }, "openai")).toBe(
      "openai",
    );
  });

  it("degrades to the generic mark rather than throwing", () => {
    expect(resolveAgentSessionIconId(null)).toBe("custom");
    expect(resolveAgentSessionIconId({ agentId: "custom" })).toBe("custom");
  });
});
