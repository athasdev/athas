const AUTHENTICATION_ERROR_PATTERNS = [
  "authentication required",
  "requires authentication",
  "not authenticated",
];

export function isAcpAuthenticationError(...messages: Array<string | undefined>): boolean {
  const normalized = messages.filter(Boolean).join(" ").toLowerCase();
  return AUTHENTICATION_ERROR_PATTERNS.some((pattern) => normalized.includes(pattern));
}
