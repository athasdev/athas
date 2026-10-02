/** Output budget for direct providers: enough for reasoning plus a visible answer. */
export const DEFAULT_CHAT_COMPLETION_TOKENS = 4096;

/**
 * Athas output budget before the model catalog arrives. The server lowers any request to the
 * model's own output limit and to what the balance can hold, so this only needs to be generous.
 */
export const HOSTED_FALLBACK_COMPLETION_TOKENS = 32_000;

/**
 * The output budget for one chat request. Hosted Athas models get their full catalog limit,
 * since the server enforces it; other providers stay at `DEFAULT_CHAT_COMPLETION_TOKENS` or
 * their smaller model limit.
 */
export function resolveChatCompletionTokenLimit(
  modelLimit: number | undefined,
  providerId?: string,
): number {
  const known = Number.isFinite(modelLimit) && modelLimit !== undefined && modelLimit >= 1;
  if (providerId === "athas") {
    return known ? Math.floor(modelLimit) : HOSTED_FALLBACK_COMPLETION_TOKENS;
  }
  if (!known) return DEFAULT_CHAT_COMPLETION_TOKENS;
  return Math.min(Math.floor(modelLimit), DEFAULT_CHAT_COMPLETION_TOKENS);
}
