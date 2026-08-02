export const CODEX_INTEGRATION_ID = "codex";

export const BUILT_IN_AI_INTEGRATIONS = [
  {
    id: CODEX_INTEGRATION_ID,
    name: "Codex",
    description: "OpenAI Codex with native threads, approvals, skills, MCP, and review",
  },
] as const;

export const isAIIntegration = (id: string) =>
  BUILT_IN_AI_INTEGRATIONS.some((integration) => integration.id === id);
