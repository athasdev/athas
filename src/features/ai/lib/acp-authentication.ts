const AUTHENTICATION_ERROR_PATTERNS = [
  "authentication required",
  "requires authentication",
  "not authenticated",
];

const CONFIGURATION_ERROR_PATTERNS = [
  "google_cloud_project",
  "google_cloud_project_id",
  "requires setting the",
];

export function isAcpAuthenticationError(...messages: Array<string | undefined>): boolean {
  const normalized = messages.filter(Boolean).join(" ").toLowerCase();
  return AUTHENTICATION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function isAcpConfigurationError(...messages: Array<string | undefined>): boolean {
  const normalized = messages.filter(Boolean).join(" ").toLowerCase();
  return CONFIGURATION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}

export function getAcpAuthenticationCommand(
  agentId: string | null | undefined,
  agents: Array<{ id: string; binaryName: string }>,
): string | null {
  if (!agentId) return null;

  const binaryName = agents.find((agent) => agent.id === agentId)?.binaryName.trim();
  if (binaryName) return binaryName;

  const fallbackCommands: Record<string, string> = {
    "gemini-cli": "gemini",
    "kimi-cli": "kimi",
    opencode: "opencode",
    "qwen-code": "qwen",
  };

  return fallbackCommands[agentId] ?? null;
}

export function getAcpStartupErrorDetails(message: string): string | null {
  const marker = "Agent stderr:";
  const markerIndex = message.indexOf(marker);
  if (markerIndex === -1) return null;

  const details = message.slice(markerIndex + marker.length).trim();
  return details || null;
}
