import { describe, expect, it } from "vite-plus/test";
import { isAcpAgent } from "@/features/ai/services/ai-chat-service";
import {
  ANTIGRAVITY_TERMINAL_AGENT_ID,
  getTerminalAgent,
  isTerminalAgent,
} from "@/features/ai/lib/terminal-agents";

describe("terminal agents", () => {
  it("launches Antigravity through its agy terminal command", () => {
    expect(getTerminalAgent(ANTIGRAVITY_TERMINAL_AGENT_ID)).toMatchObject({
      name: "Antigravity CLI",
      command: "agy",
      isAcp: false,
    });
  });

  it("keeps terminal agents outside ACP chat handling", () => {
    expect(isTerminalAgent("claude-code")).toBe(true);
    expect(isTerminalAgent(ANTIGRAVITY_TERMINAL_AGENT_ID)).toBe(true);
    expect(isAcpAgent("claude-code")).toBe(false);
    expect(isAcpAgent(ANTIGRAVITY_TERMINAL_AGENT_ID)).toBe(false);
    expect(isAcpAgent("opencode")).toBe(true);
  });
});
