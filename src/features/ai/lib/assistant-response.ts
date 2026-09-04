import type { Message } from "@/features/ai/types/ai-chat.types";

export function startAssistantResponseContinuation(content: string): string {
  const current = content.trimEnd();
  return current ? `${current}\n\n` : "";
}

function mergeOptionalArrays<T>(left?: T[], right?: T[]): T[] | undefined {
  const values = [...(left ?? []), ...(right ?? [])];
  return values.length > 0 ? values : undefined;
}

export function coalesceAssistantResponses(messages: Message[]): Message[] {
  const result: Message[] = [];

  for (const message of messages) {
    const previous = result[result.length - 1];
    if (message.role !== "assistant" || previous?.role !== "assistant") {
      result.push(message);
      continue;
    }

    const nextContent = message.content.trimStart();
    result[result.length - 1] = {
      ...previous,
      content: nextContent
        ? `${startAssistantResponseContinuation(previous.content)}${nextContent}`
        : previous.content,
      timestamp: message.timestamp,
      isStreaming: message.isStreaming,
      responsePhase: message.responsePhase,
      isToolUse: previous.isToolUse || message.isToolUse,
      toolName: message.toolName ?? previous.toolName,
      toolCalls: mergeOptionalArrays(previous.toolCalls, message.toolCalls),
      images: mergeOptionalArrays(previous.images, message.images),
      resources: mergeOptionalArrays(previous.resources, message.resources),
      ui: mergeOptionalArrays(previous.ui, message.ui),
      followUpActions: message.followUpActions ?? previous.followUpActions,
    };
  }

  return result;
}
