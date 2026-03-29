import type { ToolCall } from "@/features/ai/types/ai-chat";

export const createToolCall = (
  toolName: string,
  toolInput: unknown,
  providedToolId?: string,
): ToolCall => {
  const resolvedId =
    providedToolId ?? `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    id: resolvedId,
    name: toolName,
    input: toolInput,
    timestamp: new Date(),
  };
};

export const markToolCallComplete = (
  toolCalls: ToolCall[],
  toolName: string,
  toolId?: string,
  result?: {
    output?: unknown;
    error?: string;
  },
): ToolCall[] => {
  if (toolCalls.length === 0) return toolCalls;

  if (toolId) {
    return toolCalls.map((toolCall) =>
      toolCall.id === toolId && !toolCall.isComplete
        ? {
            ...toolCall,
            isComplete: true,
            output: result?.output ?? toolCall.output,
            error: result?.error ?? toolCall.error,
          }
        : toolCall,
    );
  }

  const latestMatchingIndex = [...toolCalls]
    .reverse()
    .findIndex((toolCall) => toolCall.name === toolName && !toolCall.isComplete);

  if (latestMatchingIndex === -1) return toolCalls;

  const resolvedIndex = toolCalls.length - 1 - latestMatchingIndex;
  return toolCalls.map((toolCall, index) =>
    index === resolvedIndex
      ? {
          ...toolCall,
          isComplete: true,
          output: result?.output ?? toolCall.output,
          error: result?.error ?? toolCall.error,
        }
      : toolCall,
  );
};
