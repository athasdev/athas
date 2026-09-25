import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type {
  AcpToolCallLocation,
  AcpToolCallStatus,
  AcpToolKind,
} from "@/features/ai/types/acp.types";

const ACP_TOOL_CONTENT_TYPES = new Set(["content", "diff", "terminal"]);

function hasOutput(value: unknown): boolean {
  return value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0);
}

function isAcpToolContent(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        ACP_TOOL_CONTENT_TYPES.has((item as { type?: unknown }).type as string),
    )
  );
}

/**
 * Resolves the output a tool call displays after a change. `output` is the
 * ACP `content` (diffs, terminals, text) and wins over `rawOutput`, which is
 * only shown when the call has no content. Missing fields leave the call as
 * it was; content that is present replaces the previous content, and an
 * empty collection clears it.
 */
function resolveOutput(
  previous: Pick<ToolCall, "output" | "rawOutput"> | undefined,
  output: unknown,
  rawOutput: unknown,
): Pick<ToolCall, "output" | "rawOutput"> {
  const nextRaw = rawOutput ?? previous?.rawOutput;
  if (output !== undefined && output !== null) {
    return { output: hasOutput(output) ? output : (nextRaw ?? undefined), rawOutput: nextRaw };
  }
  if (isAcpToolContent(previous?.output)) {
    return { output: previous?.output, rawOutput: nextRaw };
  }
  return { output: nextRaw ?? previous?.output, rawOutput: nextRaw };
}

export const createToolCall = (
  toolName: string,
  toolInput: unknown,
  providedToolId?: string,
  kind?: AcpToolKind,
  status?: AcpToolCallStatus,
  locations?: AcpToolCallLocation[],
  output?: unknown,
  rawOutput?: unknown,
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
    ...(hasOutput(output) || hasOutput(rawOutput)
      ? resolveOutput(undefined, output, rawOutput)
      : {}),
    timestamp: new Date(),
  };
};

export interface ToolCallPatch {
  id: string;
  name?: string | null;
  input?: unknown;
  output?: unknown;
  rawOutput?: unknown;
  error?: string | null;
  kind?: AcpToolKind | null;
  status?: AcpToolCallStatus | null;
  locations?: AcpToolCallLocation[] | null;
}

export const updateToolCall = (toolCalls: ToolCall[], patch: ToolCallPatch): ToolCall[] => {
  // Some agents send the first update for a call before (or instead of) its
  // start event; dropping it would leave the transcript without the call.
  if (!toolCalls.some((toolCall) => toolCall.id === patch.id)) {
    const created = createToolCall(
      patch.name ?? "tool",
      patch.input,
      patch.id,
      patch.kind ?? undefined,
      patch.status ?? undefined,
      patch.locations ?? undefined,
      patch.output,
      patch.rawOutput,
    );
    return [
      ...toolCalls,
      {
        ...created,
        error: patch.error ?? undefined,
        isComplete: patch.status === "completed" || patch.status === "failed" ? true : undefined,
      },
    ];
  }

  return toolCalls.map((toolCall) => {
    if (toolCall.id !== patch.id) return toolCall;

    const nextStatus = patch.status ?? toolCall.status;

    return {
      ...toolCall,
      name: patch.name ?? toolCall.name,
      input: patch.input ?? toolCall.input,
      ...resolveOutput(toolCall, patch.output, patch.rawOutput),
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
            ...resolveOutput(toolCall, output, undefined),
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
          ...resolveOutput(toolCall, output, undefined),
          error,
          status: error ? "failed" : "completed",
          isComplete: true,
        }
      : toolCall,
  );
};

/**
 * Marks the calls still pending or running when their turn ended (cancelled, cut off, or
 * failed) as cancelled, so none of them keeps showing as running.
 */
export const cancelUnfinishedToolCalls = (
  toolCalls: ToolCall[] | undefined,
): ToolCall[] | undefined => {
  if (!toolCalls?.some((toolCall) => !toolCall.isComplete)) return toolCalls;
  return toolCalls.map((toolCall) =>
    toolCall.isComplete ? toolCall : { ...toolCall, status: "cancelled", isComplete: true },
  );
};
