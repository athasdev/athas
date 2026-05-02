import type { ToolCall } from "@/features/ai/types/ai-chat";
import type { AcpToolCallLocation, AcpToolCallStatus, AcpToolKind } from "@/features/ai/types/acp";

export const createToolCall = (
  toolName: string,
  toolInput: unknown,
  providedToolId?: string,
  kind?: AcpToolKind,
  status?: AcpToolCallStatus,
  locations?: AcpToolCallLocation[],
): ToolCall => {
  const resolvedId =
    providedToolId ?? `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return {
    id: resolvedId,
    name: toolName,
    input: toolInput,
    kind,
    status,
    locations,
    timestamp: new Date(),
  };
};

export interface ToolCallPatch {
  id: string;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  kind?: AcpToolKind | null;
  status?: AcpToolCallStatus | null;
  locations?: AcpToolCallLocation[] | null;
}

export const updateToolCall = (toolCalls: ToolCall[], patch: ToolCallPatch): ToolCall[] => {
  if (toolCalls.length === 0) return toolCalls;

  return toolCalls.map((toolCall) => {
    if (toolCall.id !== patch.id) return toolCall;

    const nextStatus = patch.status ?? toolCall.status;

    return {
      ...toolCall,
      name: patch.name ?? toolCall.name,
      input: patch.input ?? toolCall.input,
      output: patch.output ?? toolCall.output,
      error: patch.error ?? toolCall.error,
      kind: patch.kind ?? toolCall.kind,
      status: nextStatus,
      locations: patch.locations ?? toolCall.locations,
      isComplete:
        nextStatus === "completed" || nextStatus === "failed" ? true : toolCall.isComplete,
    };
  });
};

export const markToolCallComplete = (
  toolCalls: ToolCall[],
  toolName: string,
  toolId?: string,
  output?: unknown,
  error?: string,
): ToolCall[] => {
  if (toolCalls.length === 0) return toolCalls;

  if (toolId) {
    return toolCalls.map((toolCall) =>
      toolCall.id === toolId
        ? {
            ...toolCall,
            output,
            error,
            status: error ? "failed" : "completed",
            isComplete: true,
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
          output,
          error,
          status: error ? "failed" : "completed",
          isComplete: true,
        }
      : toolCall,
  );
};
