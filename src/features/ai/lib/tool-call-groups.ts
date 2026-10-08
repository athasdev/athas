import type { ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AcpToolKind } from "@/features/ai/types/acp.types";
import { getAcpDiffOutputs } from "./acp-diff-output";
import {
  getToolCallPhase,
  inferToolKind,
  resolveToolCallPath,
  summarizeToolCall,
} from "./tool-call-summary";

/** What a run of tool calls between two stretches of text reads as in the transcript. */
export type ToolActivityItem =
  /** A lone step keeps its own row. */
  | { type: "call"; key: string; toolCall: ToolCall }
  /** A lone thought reads as "Thought for 3s". */
  | { type: "thought"; key: string; toolCall: ToolCall }
  /** Two or more steps fold into one summary row. */
  | { type: "group"; key: string; toolCalls: ToolCall[]; summary: ToolActivitySummary };

interface ToolActivityStep {
  kind: AcpToolKind;
  /** Distinct files for file kinds, calls for everything else. */
  count: number;
}

export interface ToolActivitySummary {
  /** Kinds in the order the agent first used them, thoughts left out. */
  steps: ToolActivityStep[];
  failed: number;
  /** The step still running, whose label stands in for the summary while it works. */
  running: ToolCall | null;
  additions: number;
  deletions: number;
  /** When the first step started, or null when the calls carry no real start time. */
  startedAt: number | null;
  /** From the first start to the last finish, once every step has finished. */
  durationMs: number | null;
}

const FILE_KINDS = new Set<AcpToolKind>(["read", "edit", "delete", "move"]);

function kindOf(toolCall: ToolCall): AcpToolKind {
  return toolCall.kind && toolCall.kind !== "other" ? toolCall.kind : inferToolKind(toolCall.name);
}

export function isThought(toolCall: ToolCall): boolean {
  return kindOf(toolCall) === "think";
}

function toolCallKey(toolCall: ToolCall, index: number): string {
  return toolCall.id || `${toolCall.name}-${index}`;
}

function startOf(toolCall: ToolCall): number | null {
  const start = new Date(toolCall.timestamp).getTime();
  // History replays stamp calls with the epoch; that is no start time at all.
  return Number.isFinite(start) && start > 0 ? start : null;
}

/** How long a finished call ran, when it recorded it. */
export function toolCallDurationMs(toolCall: ToolCall): number | null {
  return typeof toolCall.durationMs === "number" && toolCall.durationMs >= 0
    ? toolCall.durationMs
    : null;
}

export function summarizeToolActivity(
  toolCalls: ToolCall[],
  options: { isStreaming?: boolean; rootFolderPath?: string | null } = {},
): ToolActivitySummary {
  const steps = new Map<AcpToolKind, { count: number; targets: Set<unknown> }>();
  let failed = 0;
  let running: ToolCall | null = null;
  let additions = 0;
  let deletions = 0;
  let startedAt: number | null = null;
  let endedAt: number | null = null;
  let allTimed = true;

  for (const toolCall of toolCalls) {
    const kind = kindOf(toolCall);
    // Thoughts have no timing of their own and take no part in the counts.
    if (kind === "think") continue;
    const phase = getToolCallPhase(toolCall, options.isStreaming);
    if (phase === "running") running ??= toolCall;
    if (phase === "failed") failed += 1;

    const start = startOf(toolCall);
    const duration = toolCallDurationMs(toolCall);
    if (start === null || (duration === null && phase !== "running")) allTimed = false;
    if (start !== null) {
      startedAt = startedAt === null ? start : Math.min(startedAt, start);
      if (duration !== null) {
        endedAt = endedAt === null ? start + duration : Math.max(endedAt, start + duration);
      }
    }

    const summary = summarizeToolCall(toolCall, options);
    additions += summary.additions;
    deletions += summary.deletions;

    const step = steps.get(kind) ?? { count: 0, targets: new Set<unknown>() };
    if (FILE_KINDS.has(kind)) {
      const paths = getAcpDiffOutputs(toolCall.output).map((diff) => diff.path);
      const targets = paths.length > 0 ? paths : [resolveToolCallPath(toolCall) ?? toolCall];
      for (const target of targets) step.targets.add(target);
      step.count = step.targets.size;
    } else {
      step.count += 1;
    }
    steps.set(kind, step);
  }

  return {
    steps: [...steps].map(([kind, { count }]) => ({ kind, count })),
    failed,
    running,
    additions,
    deletions,
    startedAt,
    durationMs:
      !running && allTimed && steps.size > 0 && startedAt !== null && endedAt !== null
        ? Math.max(0, endedAt - startedAt)
        : null,
  };
}

/**
 * Folds each run of two or more tool calls into one summary, so a turn that read a dozen files
 * and ran the tests reads as one line until the user asks for the steps. A lone call keeps its
 * row, and a lone thought becomes a "Thought" disclosure.
 */
export function buildToolActivity(
  toolCalls: ToolCall[],
  options: { isStreaming?: boolean; rootFolderPath?: string | null } = {},
): ToolActivityItem[] {
  if (toolCalls.length === 0) return [];
  if (toolCalls.length === 1) {
    const toolCall = toolCalls[0]!;
    const key = toolCallKey(toolCall, 0);
    return [
      isThought(toolCall) ? { type: "thought", key, toolCall } : { type: "call", key, toolCall },
    ];
  }
  return [
    {
      type: "group",
      key: `group-${toolCallKey(toolCalls[0]!, 0)}`,
      toolCalls,
      summary: summarizeToolActivity(toolCalls, options),
    },
  ];
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function describeStep({ kind, count }: ToolActivityStep): string {
  switch (kind) {
    case "read":
      return `read ${plural(count, "file")}`;
    case "edit":
      return `edited ${plural(count, "file")}`;
    case "delete":
      return `deleted ${plural(count, "file")}`;
    case "move":
      return `moved ${plural(count, "file")}`;
    case "search":
      return count === 1
        ? "searched once"
        : count === 2
          ? "searched twice"
          : `searched ${count} times`;
    case "execute":
      return `ran ${plural(count, "command")}`;
    case "fetch":
      return `fetched ${plural(count, "page")}`;
    case "switch_mode":
      return "switched mode";
    case "think":
      return "thought";
    default:
      return `used ${plural(count, "tool")}`;
  }
}

/** "Read 4 files, edited 2 files, ran 1 command", in the order the agent worked. */
export function describeToolActivity(summary: Pick<ToolActivitySummary, "steps">): string {
  const text = summary.steps.map(describeStep).join(", ");
  return text ? `${text[0]!.toUpperCase()}${text.slice(1)}` : "Thought";
}

/** The last call that recorded a diff: the one edit worth opening on its own. */
export function findLatestEdit(toolCalls: ToolCall[] = []): ToolCall | null {
  for (let index = toolCalls.length - 1; index >= 0; index--) {
    const toolCall = toolCalls[index]!;
    if (getAcpDiffOutputs(toolCall.output).length > 0) return toolCall;
  }
  return null;
}
