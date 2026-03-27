import { buildContextPrompt } from "./context-builder";
import type { ContextInfo } from "./types";

export function buildPiNativePromptMessage(userMessage: string, context: ContextInfo): string {
  const trimmedMessage = userMessage.trimStart();
  if (/^\/\S+/.test(trimmedMessage)) {
    return trimmedMessage;
  }

  const contextPrompt = buildContextPrompt(context);
  return [contextPrompt, userMessage].filter(Boolean).join("\n\n");
}
