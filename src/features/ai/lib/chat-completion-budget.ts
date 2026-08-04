export const DEFAULT_CHAT_COMPLETION_TOKENS = 4096;

export function resolveChatCompletionTokenLimit(modelLimit: number | undefined): number {
  if (!Number.isFinite(modelLimit) || !modelLimit || modelLimit < 1) {
    return DEFAULT_CHAT_COMPLETION_TOKENS;
  }

  return Math.min(Math.floor(modelLimit), DEFAULT_CHAT_COMPLETION_TOKENS);
}
