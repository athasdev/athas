import { asSchema, type ModelMessage, type ToolResultPart, type ToolSet } from "ai";
import {
  HOSTED_ATHAS_REQUEST_LIMITS,
  type ProviderRequestLimits,
} from "@/features/ai/lib/conversation-history";

type StepRequestLimits = Pick<ProviderRequestLimits, "maxMessages" | "maxBytes">;

/**
 * What one model request of the agent loop may carry. Athas's hosted endpoint rejects anything
 * larger; other providers get a generous cap that still keeps a long turn from growing without
 * bound, since every step resends every earlier tool result.
 */
export function getStepRequestLimits(providerId: string): StepRequestLimits {
  if (providerId === "athas") {
    return {
      maxMessages: HOSTED_ATHAS_REQUEST_LIMITS.maxMessages,
      maxBytes: HOSTED_ATHAS_REQUEST_LIMITS.maxBytes,
    };
  }
  return { maxMessages: 1_000, maxBytes: 600_000 };
}

export const TRIMMED_TOOL_RESULT = "[trimmed: re-read if needed]";
/** Tool results kept whole before any older one is trimmed. */
const KEEP_RECENT_RESULTS = 6;
/** Results this small cost less than the confusion of trimming them. */
const MIN_TRIMMABLE_BYTES = 400;
const STEPS_REMOVED =
  /^\[(\d+) earlier tool steps? of this turn removed to fit the request limit\]$/;

/** Tools whose output the model can fetch again, trimmed before anything else. */
function isRereadable(toolName: string) {
  return (
    toolName === "read_file" ||
    toolName === "search_files" ||
    toolName === "list_files" ||
    toolName.startsWith("mcp__")
  );
}

const encoder = new TextEncoder();

/** Image parts count toward the provider's separate image limit, not the text size. */
function withoutImageData(key: string, value: unknown) {
  if (!value || typeof value !== "object") return value;
  const part = value as { type?: unknown; mediaType?: unknown };
  if (part.type === "image") return { type: "image" };
  if (
    part.type === "file" &&
    typeof part.mediaType === "string" &&
    part.mediaType.startsWith("image")
  )
    return { type: "file" };
  return value;
}

export function serializedBytes(value: unknown): number {
  return value === undefined ? 0 : encoder.encode(JSON.stringify(value, withoutImageData)).length;
}

/** Bytes the tool definitions add to every request of the loop. */
export async function measureToolDefinitions(tools: ToolSet): Promise<number> {
  try {
    const definitions = await Promise.all(
      Object.entries(tools).map(async ([name, entry]) => ({
        name,
        description: entry.description,
        schema: entry.inputSchema ? await asSchema(entry.inputSchema).jsonSchema : undefined,
      })),
    );
    return serializedBytes(definitions);
  } catch {
    return 0;
  }
}

interface ResultRef {
  message: number;
  part: number;
  toolName: string;
  bytes: number;
}

function toolResults(messages: ModelMessage[]): ResultRef[] {
  const refs: ResultRef[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "tool") return;
    message.content.forEach((part, partIndex) => {
      if (part.type !== "tool-result") return;
      if (part.output.type === "text" && part.output.value === TRIMMED_TOOL_RESULT) return;
      refs.push({
        message: messageIndex,
        part: partIndex,
        toolName: part.toolName,
        bytes: serializedBytes(part.output),
      });
    });
  });
  return refs;
}

function replaceOutput(
  messages: ModelMessage[],
  ref: ResultRef,
  output: ToolResultPart["output"],
): number {
  const message = messages[ref.message];
  if (message.role !== "tool") return 0;
  const content = [...message.content];
  const part = content[ref.part] as ToolResultPart;
  content[ref.part] = { ...part, output };
  messages[ref.message] = { ...message, content };
  return ref.bytes - serializedBytes(output);
}

function stepsRemovedNote(message: ModelMessage): number {
  if (message.role !== "assistant" || typeof message.content === "string") return 0;
  const first = message.content[0];
  const match = first?.type === "text" ? STEPS_REMOVED.exec(first.text) : null;
  return match ? Number(match[1]) : 0;
}

/**
 * Drops the oldest tool steps of this turn (an assistant tool call and its results together, so
 * every call still has its result) until the message count fits, and notes how many went.
 */
function dropOldestSteps(messages: ModelMessage[], firstStep: number, maxMessages: number) {
  let removed = 0;
  let index = firstStep;
  while (messages.length > maxMessages && index < messages.length - 2) {
    const [call, results] = [messages[index], messages[index + 1]];
    if (call.role !== "assistant" || results.role !== "tool") {
      index++;
      continue;
    }
    removed += 1 + stepsRemovedNote(call);
    messages.splice(index, 2);
  }
  if (!removed) return;
  const next = messages[index];
  if (next?.role !== "assistant") return;
  const total = removed + stepsRemovedNote(next);
  const text = `[${total} earlier tool step${total === 1 ? "" : "s"} of this turn removed to fit the request limit]`;
  const content =
    typeof next.content === "string"
      ? [{ type: "text" as const, text: next.content }]
      : next.content.filter((_, position) => position > 0 || !stepsRemovedNote(next));
  messages[index] = { ...next, content: [{ type: "text", text }, ...content] };
}

/**
 * Keeps one step's request inside `limits` before it is sent. Older tool results are replaced by
 * a short stub, rereadable ones (file reads, searches, MCP calls) first and the most recent few
 * last. When a turn has more steps than the message cap allows, its oldest steps are dropped. Returns undefined when nothing had to change.
 */
export function fitStepMessages(
  input: ModelMessage[],
  limits: StepRequestLimits,
  options: { firstStep: number; instructionBytes?: number },
): ModelMessage[] | undefined {
  const fixedBytes = options.instructionBytes ?? 0;
  let bytes = serializedBytes(input) + fixedBytes;
  if (bytes <= limits.maxBytes && input.length <= limits.maxMessages) return undefined;

  const messages = [...input];
  if (messages.length > limits.maxMessages) {
    dropOldestSteps(messages, options.firstStep, limits.maxMessages);
    bytes = serializedBytes(messages) + fixedBytes;
  }

  const stub = { type: "text" as const, value: TRIMMED_TOOL_RESULT };
  const passes: Array<{ keep: number; rereadableOnly: boolean }> = [
    { keep: KEEP_RECENT_RESULTS, rereadableOnly: true },
    { keep: KEEP_RECENT_RESULTS, rereadableOnly: false },
    { keep: 1, rereadableOnly: false },
    { keep: 0, rereadableOnly: false },
  ];
  for (const pass of passes) {
    if (bytes <= limits.maxBytes) break;
    const refs = toolResults(messages);
    for (const ref of refs.slice(0, Math.max(0, refs.length - pass.keep))) {
      if (bytes <= limits.maxBytes) break;
      if (ref.bytes < MIN_TRIMMABLE_BYTES) continue;
      if (pass.rereadableOnly && !isRereadable(ref.toolName)) continue;
      bytes -= replaceOutput(messages, ref, stub);
    }
  }
  return messages;
}
