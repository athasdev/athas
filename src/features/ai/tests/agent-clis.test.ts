import { describe, expect, it } from "vite-plus/test";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import { getAgentCli, migrateLegacyAgentId } from "@/features/ai/services/agent-clis";

describe("agent terminal CLIs", () => {
  it("moves the former terminal-only agents to their ACP agents", () => {
    expect(migrateLegacyAgentId("claude-code")).toBe("claude-acp");
    expect(migrateLegacyAgentId("antigravity-cli")).toBe("antigravity-acp");
    expect(isAcpAgent(migrateLegacyAgentId("claude-code"))).toBe(true);
    expect(isAcpAgent(migrateLegacyAgentId("antigravity-cli"))).toBe(true);
  });

  it("leaves every other agent id alone", () => {
    for (const agentId of ["custom", "codex", "claude-acp", "gemini-cli", "opencode", "goose"]) {
      expect(migrateLegacyAgentId(agentId)).toBe(agentId);
    }
  });

  it("knows each agent's own CLI for the explicit open-in-terminal action", () => {
    expect(getAgentCli("claude-acp")).toEqual({ name: "Claude CLI", command: "claude" });
    expect(getAgentCli("claude-code")).toEqual({ name: "Claude CLI", command: "claude" });
    expect(getAgentCli("antigravity-acp")).toEqual({ name: "Antigravity CLI", command: "agy" });
    expect(getAgentCli("opencode")?.command).toBe("opencode");
    expect(getAgentCli("custom")).toBeNull();
    expect(getAgentCli(null)).toBeNull();
  });
});
