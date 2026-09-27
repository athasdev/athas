import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import { getAcpDiffOutputs } from "./acp-diff-output";
import { getToolCallPhase, inferToolKind, resolveToolCallPath } from "./tool-call-summary";

export type ToolCallListItem =
  | { type: "call"; key: string; toolCall: ToolCall }
  | {
      type: "exploration";
      key: string;
      toolCalls: ToolCall[];
      files: number;
      searches: number;
      isRunning: boolean;
    };

function kindOf(toolCall: ToolCall) {
  return toolCall.kind && toolCall.kind !== "other" ? toolCall.kind : inferToolKind(toolCall.name);
}

export function toolCallKey(toolCall: ToolCall, index: number): string {
  return toolCall.id || `${toolCall.name}-${index}`;
}

/** Reads and searches that went through; a failed or declined one keeps its own row. */
function isExploration(toolCall: ToolCall, isStreaming?: boolean): boolean {
  const kind = kindOf(toolCall);
  if (kind !== "read" && kind !== "search") return false;
  const phase = getToolCallPhase(toolCall, isStreaming);
  return phase === "done" || phase === "running";
}

/**
 * Folds runs of two or more consecutive reads and searches into one exploration item, so an
 * agent looking around the codebase reads as one line instead of a dozen.
 */
export function groupToolCalls(toolCalls: ToolCall[], isStreaming?: boolean): ToolCallListItem[] {
  const items: ToolCallListItem[] = [];
  let run: { toolCall: ToolCall; index: number }[] = [];

  const flushRun = () => {
    if (run.length === 1) {
      const [{ toolCall, index }] = run as [{ toolCall: ToolCall; index: number }];
      items.push({ type: "call", key: toolCallKey(toolCall, index), toolCall });
    } else if (run.length > 1) {
      const calls = run.map((entry) => entry.toolCall);
      const reads = calls.filter((toolCall) => kindOf(toolCall) === "read");
      const readPaths = new Set(reads.map((toolCall) => resolveToolCallPath(toolCall) ?? toolCall));
      items.push({
        type: "exploration",
        key: `exploration-${toolCallKey(run[0]!.toolCall, run[0]!.index)}`,
        toolCalls: calls,
        files: readPaths.size,
        searches: calls.length - reads.length,
        isRunning: calls.some((toolCall) => getToolCallPhase(toolCall, isStreaming) === "running"),
      });
    }
    run = [];
  };

  toolCalls.forEach((toolCall, index) => {
    if (isExploration(toolCall, isStreaming)) {
      run.push({ toolCall, index });
      return;
    }
    flushRun();
    items.push({ type: "call", key: toolCallKey(toolCall, index), toolCall });
  });
  flushRun();

  return items;
}

export function describeExploration({
  files,
  searches,
  isRunning,
}: {
  files: number;
  searches: number;
  isRunning: boolean;
}): string {
  const parts = [
    files > 0 ? `${files} ${files === 1 ? "file" : "files"}` : null,
    searches > 0 ? `${searches} ${searches === 1 ? "search" : "searches"}` : null,
  ].filter(Boolean);
  return `${isRunning ? "Exploring" : "Explored"} ${parts.join(", ")}`;
}

/** The last call that recorded a diff: the one edit worth opening on its own. */
export function findLatestEdit(toolCalls: ToolCall[] = []): ToolCall | null {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index]!;
    if (getAcpDiffOutputs(toolCall.output).length > 0) return toolCall;
  }
  return null;
}
