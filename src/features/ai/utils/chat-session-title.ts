export function normalizeAgentSessionTitle(value: string): string | null {
  const normalized = value
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  return normalized.split(" ").slice(0, 2).join(" ").trim() || null;
}

export function getFallbackAgentSessionTitle(message: string): string {
  return message.length > 50 ? `${message.substring(0, 50)}...` : message;
}
