import type { AgentType } from "@/features/ai/types/ai-chat.types";
import { CLAUDE_ACP_AGENT_ID, LEGACY_CLAUDE_CODE_TERMINAL_AGENT_ID } from "../lib/claude-code";

/**
 * Agents that used to open only as terminal CLIs, mapped to the ACP agent that now runs them in
 * the chat. Saved selections and chats that still carry an old id open the ACP agent instead.
 */
const LEGACY_TERMINAL_AGENT_IDS: Readonly<Record<string, AgentType>> = {
  [LEGACY_CLAUDE_CODE_TERMINAL_AGENT_ID]: CLAUDE_ACP_AGENT_ID,
  "antigravity-cli": "antigravity-acp",
};

export function migrateLegacyAgentId(agentId: AgentType): AgentType {
  return LEGACY_TERMINAL_AGENT_IDS[agentId] ?? agentId;
}

interface AgentCli {
  name: string;
  command: string;
}

/**
 * The interactive CLI behind each ACP agent. Agents always run in the chat; the CLI only opens in
 * a terminal when the user asks for it explicitly.
 */
const AGENT_CLIS: Readonly<Record<string, AgentCli>> = {
  [CLAUDE_ACP_AGENT_ID]: { name: "Claude CLI", command: "claude" },
  "antigravity-acp": { name: "Antigravity CLI", command: "agy" },
  "gemini-cli": { name: "Gemini CLI", command: "gemini" },
  "github-copilot-cli": { name: "GitHub Copilot CLI", command: "copilot" },
  "kimi-cli": { name: "Kimi CLI", command: "kimi" },
  opencode: { name: "OpenCode", command: "opencode" },
  "qwen-code": { name: "Qwen Code", command: "qwen" },
  codex: { name: "Codex CLI", command: "codex" },
};

export function getAgentCli(agentId: AgentType | null | undefined): AgentCli | null {
  if (!agentId) return null;
  return AGENT_CLIS[migrateLegacyAgentId(agentId)] ?? null;
}
