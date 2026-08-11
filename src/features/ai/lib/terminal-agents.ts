import { CLAUDE_CODE_TERMINAL_COMMAND, CLAUDE_CODE_TERMINAL_OPTION } from "./claude-code";

export const ANTIGRAVITY_TERMINAL_AGENT_ID = "antigravity-cli";

export const TERMINAL_AGENT_OPTIONS = [
  {
    ...CLAUDE_CODE_TERMINAL_OPTION,
    command: CLAUDE_CODE_TERMINAL_COMMAND,
  },
  {
    id: ANTIGRAVITY_TERMINAL_AGENT_ID,
    name: "Antigravity CLI",
    description: "Open Antigravity CLI in an Athas terminal",
    command: "agy",
    isAcp: false,
  },
] as const;

export function isTerminalAgent(agentId: string): boolean {
  return TERMINAL_AGENT_OPTIONS.some((agent) => agent.id === agentId);
}

export function getTerminalAgent(agentId: string) {
  return TERMINAL_AGENT_OPTIONS.find((agent) => agent.id === agentId);
}
