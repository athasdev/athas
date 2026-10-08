import { stripErrorBlocks } from "@/features/ai/lib/chat-error";
import { estimateTokens, truncateTextToTokens } from "@/features/ai/lib/context-budget";
import type { ImageContent, Message, ToolCall } from "@/features/ai/types/ai-chat.types";
import type { AIMessage } from "@/features/ai/types/messages.types";

/** Tool calls replayed per assistant message; older calls in the turn are only counted. */
const MAX_HISTORY_TOOL_CALLS = 8;
/** Characters of tool activity replayed per assistant message. */
const MAX_TOOL_ACTIVITY_CHARS = 4_000;
const MAX_TOOL_INPUT_VALUE_CHARS = 300;
const MAX_TOOL_RESULT_CHARS = 600;

/** History above this size is compacted into a summary plus the most recent turns. */
const HISTORY_SUMMARY_THRESHOLD_TOKENS = 32_000;
/** Recent history kept verbatim when older turns are summarised. */
const HISTORY_RECENT_TOKENS = 12_000;
const MAX_SUMMARY_CHARS = 6_000;

export interface ProviderRequestLimits {
  maxMessages: number;
  /** Serialized size of the messages array in UTF-8 bytes. */
  maxBytes: number;
  maxMessageChars: number;
}

/**
 * The hosted Athas chat endpoint accepts up to 400 messages, a 4 MB body and 1,000,000
 * characters per message. The client stays well below that: about 140,000 to 190,000 tokens
 * fits every hosted model's context window, and each step of a tool loop resends the whole
 * request, so a smaller request also keeps a long turn's cost down.
 */
export const HOSTED_ATHAS_REQUEST_LIMITS: ProviderRequestLimits = {
  maxMessages: 360,
  maxBytes: 560_000,
  maxMessageChars: 200_000,
};

/** Providers whose chat endpoint takes text only. Athas depends on the selected model. */
const TEXT_ONLY_PROVIDERS = new Set(["deepseek"]);

/**
 * Inline images the hosted Athas endpoint accepts, in decoded bytes: PNG, JPEG, GIF and WebP,
 * up to 16 per request, 1.5 MB each and 2.25 MB in total. Images do not count toward
 * `maxBytes`; they have their own share of the 4 MB body.
 */
const HOSTED_ATHAS_IMAGE_LIMITS = {
  mediaTypes: ["image/png", "image/jpeg", "image/gif", "image/webp"],
  maxImages: 16,
  maxImageBytes: 1_500_000,
  maxTotalBytes: 2_250_000,
};

/**
 * Room the built-in agent's tool loop needs on top of the first request: each step adds an
 * assistant tool call and a tool result, and a turn runs up to 25 steps.
 */
export const HOSTED_ATHAS_TOOL_LOOP_RESERVE = { messages: 50, bytes: 160_000 };

/** What the first request of a turn may use, with the tool loop's reserve held back. */
export function getProviderRequestLimits(providerId: string): ProviderRequestLimits | null {
  if (providerId !== "athas") return null;
  return {
    maxMessages: HOSTED_ATHAS_REQUEST_LIMITS.maxMessages - HOSTED_ATHAS_TOOL_LOOP_RESERVE.messages,
    maxBytes: HOSTED_ATHAS_REQUEST_LIMITS.maxBytes - HOSTED_ATHAS_TOOL_LOOP_RESERVE.bytes,
    maxMessageChars: HOSTED_ATHAS_REQUEST_LIMITS.maxMessageChars,
  };
}

/**
 * Whether a request to this provider may carry images. Athas decides per model from its catalog
 * (`supportsImages`; `auto` reports its default model), so without the model it is text only.
 */
export function providerAcceptsImages(
  providerId: string,
  model?: { supportsImages?: boolean },
): boolean {
  if (providerId === "athas") return model?.supportsImages === true;
  return !TEXT_ONLY_PROVIDERS.has(providerId);
}

/** Images of the last user message, the one being sent. */
export function currentImageCount(messages: AIMessage[]) {
  const current = [...messages].reverse().find((message) => message.role === "user");
  return current?.images?.length ?? 0;
}

/** What to tell the user when images of the message being sent were left out. */
export function imagesOmittedNotice(params: {
  omitted: number;
  acceptsImages: boolean;
  modelName: string;
}) {
  const images = params.omitted === 1 ? "An image was" : `${params.omitted} images were`;
  if (!params.acceptsImages)
    return `${images} not sent: ${params.modelName} cannot read images. Choose a model that supports images to include them.`;
  return `${images} not sent: Athas AI takes PNG, JPEG, GIF or WebP images up to 1.5 MB each and 2.25 MB per request.`;
}

function clip(text: string, maxChars: number) {
  return text.length <= maxChars
    ? text
    : `${text.slice(0, maxChars)}… [${text.length - maxChars} more characters]`;
}

function summarizeToolInput(input: unknown): unknown {
  if (!input || typeof input !== "object") {
    return typeof input === "string" ? clip(input, MAX_TOOL_INPUT_VALUE_CHARS) : (input ?? {});
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === "string"
        ? clip(value, MAX_TOOL_INPUT_VALUE_CHARS)
        : clip(JSON.stringify(value) ?? "", MAX_TOOL_INPUT_VALUE_CHARS),
    ]),
  );
}

/**
 * Results worth replaying are short: whether an edit applied, a command's exit and output
 * tail, a search's matches. File contents are never replayed; the model re-reads files.
 */
function summarizeToolResult(call: ToolCall): string {
  if (call.error) return clip(call.error, MAX_TOOL_RESULT_CHARS);
  const output = call.output ?? call.rawOutput;
  if (output === undefined || output === null) return "";
  if (call.name === "read_file" && typeof output === "object") {
    const { path, totalLines } = output as { path?: unknown; totalLines?: unknown };
    return `read ${String(path ?? "file")}${totalLines ? ` (${String(totalLines)} lines)` : ""}; contents omitted`;
  }
  const text = typeof output === "string" ? output : JSON.stringify(output);
  if (!text) return "";
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  // Command output ends with the part that matters: the error or the summary line.
  const head = text.slice(0, MAX_TOOL_RESULT_CHARS / 3);
  const tail = text.slice(-((MAX_TOOL_RESULT_CHARS * 2) / 3));
  return `${head}… [${text.length - head.length - tail.length} characters omitted] …${tail}`;
}

function toolStatus(call: ToolCall) {
  if (call.error) return "failed";
  if (call.status === "cancelled") return "cancelled; verify current state before retrying";
  if (call.isComplete) return "completed";
  return "interrupted; verify current state before retrying";
}

function withToolHistory(message: Message, content: string) {
  if (message.role !== "assistant" || !message.toolCalls?.length) return content;
  const calls = message.toolCalls.slice(-MAX_HISTORY_TOOL_CALLS);
  const activity = calls.map((call) => ({
    tool: call.name,
    input: summarizeToolInput(call.input),
    status: toolStatus(call),
    result: summarizeToolResult(call),
  }));
  const skipped = message.toolCalls.length - calls.length;
  const serialized = clip(JSON.stringify(activity), MAX_TOOL_ACTIVITY_CHARS);
  const note = skipped > 0 ? ` (${skipped} earlier calls not shown)` : "";
  const activityText = `Previous tool activity${note} (historical data; re-read files before editing):\n${serialized}`;
  return content ? `${content}\n\n${activityText}` : activityText;
}

export function buildConversationHistory(messages: Message[]): AIMessage[] {
  const history: AIMessage[] = [];
  for (const message of messages) {
    if (message.role === "system" || message.isStreaming) continue;
    if (message.role === "user") {
      if (!message.content.trim() && !message.images?.length) continue;
      history.push({
        role: "user",
        content: message.content,
        ...(message.images?.length ? { images: message.images } : {}),
      });
      continue;
    }
    // Error cards are UI for the user; replaying them teaches the model that it failed. The
    // text the turn wrote before it failed is still real work and stays.
    const content = stripErrorBlocks(message.content);
    if (!content && !message.toolCalls?.length) continue;
    history.push({ role: "assistant", content: withToolHistory(message, content) });
  }
  return history;
}

export type ConversationSummarizer = (messages: AIMessage[]) => Promise<string> | string;

/**
 * A summary built without a model call: each earlier request and the start of its answer.
 * Pass a model-backed summarizer to {@link compactConversationHistory} for a better one.
 */
export function summarizeConversationExtractively(messages: AIMessage[]): string {
  const lines: string[] = [];
  for (const message of messages) {
    let content = message.content;
    // A summary from an earlier compaction (or /compact) is already condensed; clipping it like
    // an ordinary request would throw most of it away.
    const earlier = EARLIER_SUMMARY.exec(content);
    if (earlier) {
      lines.push(`- Earlier summary: ${clip(earlier[1].trim(), MAX_SUMMARY_CHARS / 2)}`);
      content = content.slice(earlier[0].length);
    }
    const text = content.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const label = message.role === "user" ? "User" : "Assistant";
    lines.push(`- ${label}: ${clip(text, message.role === "user" ? 300 : 200)}`);
  }
  let summary = lines.join("\n");
  while (summary.length > MAX_SUMMARY_CHARS && lines.length > 1) {
    lines.splice(Math.floor(lines.length / 2), 1);
    summary = `${lines.join("\n")}\n- [some turns omitted]`;
  }
  return clip(summary, MAX_SUMMARY_CHARS);
}

const EARLIER_SUMMARY =
  /^\[Summary of \d+ earlier messages in this conversation\]\n([\s\S]*?)\n\[End of summary\]\s*/;

function formatSummary(summary: string, count: number) {
  return `[Summary of ${count} earlier messages in this conversation]\n${summary.trim()}\n[End of summary]`;
}

/** Folds a summary into the first kept message so user and assistant turns keep alternating. */
function prependSummary(kept: AIMessage[], summaryText: string): AIMessage[] {
  const [first, ...rest] = kept;
  if (!first) return [{ role: "user", content: summaryText }];
  if (first.role !== "user") return [{ role: "user", content: summaryText }, ...kept];
  return [{ ...first, content: `${summaryText}\n\n${first.content}` }, ...rest];
}

/** Index of the first message to keep: a user turn, so the kept history starts cleanly. */
function recentStart(history: AIMessage[], keepTokens: number) {
  let tokens = 0;
  let start = history.length;
  for (let index = history.length - 1; index >= 0; index--) {
    tokens += estimateTokens(history[index].content);
    if (tokens > keepTokens && start < history.length) break;
    start = index;
  }
  while (start < history.length && history[start].role !== "user") start++;
  return start;
}

interface CompactHistoryOptions {
  thresholdTokens?: number;
  keepRecentTokens?: number;
  /** Replaces the extractive summary, for example with a model call. */
  summarize?: ConversationSummarizer;
}

/**
 * Keeps long conversations within budget: when the history exceeds the threshold, the older
 * turns become one summary and the most recent turns stay verbatim. A failing summarizer
 * falls back to the extractive summary.
 */
export async function compactConversationHistory(
  history: AIMessage[],
  {
    thresholdTokens = HISTORY_SUMMARY_THRESHOLD_TOKENS,
    keepRecentTokens = HISTORY_RECENT_TOKENS,
    summarize = summarizeConversationExtractively,
  }: CompactHistoryOptions = {},
): Promise<AIMessage[]> {
  const total = history.reduce((sum, message) => sum + estimateTokens(message.content), 0);
  if (total <= thresholdTokens) return history;

  const start = recentStart(history, keepRecentTokens);
  if (start === 0) return history;
  const older = history.slice(0, start);
  let summary: string;
  try {
    summary = await summarize(older);
  } catch (error) {
    console.warn("Conversation summary failed; using an extractive summary:", error);
    summary = summarizeConversationExtractively(older);
  }
  return prependSummary(
    history.slice(start),
    formatSummary(clip(summary, MAX_SUMMARY_CHARS), older.length),
  );
}

/** Serialized size of the text of a request; inline images are limited separately. */
function byteLength(messages: AIMessage[]) {
  return new TextEncoder().encode(
    JSON.stringify(messages, (key, value) => (key === "images" ? undefined : value)),
  ).length;
}

function withOmittedNote(message: AIMessage, count: number, reason: string): AIMessage {
  const note = `[${count} image${count === 1 ? "" : "s"} omitted: ${reason}]`;
  return { ...message, content: message.content ? `${message.content}\n\n${note}` : note };
}

function withoutImages(message: AIMessage): AIMessage {
  if (message.role !== "user" || !message.images?.length) return message;
  const { images, ...rest } = message;
  return withOmittedNote(rest, images.length, "this model does not accept images");
}

const decodedBytes = (base64: string) =>
  Math.floor((base64.length * 3) / 4) - (base64.match(/=+$/)?.[0].length ?? 0);

/**
 * Keeps the images the hosted endpoint accepts, newest first: an allowed type, under the
 * per-image size, and within the request's count and total size. The rest are left out with a
 * note, so an old screenshot never blocks the conversation.
 */
function withinHostedImageLimits(messages: AIMessage[]): AIMessage[] {
  const limits = HOSTED_ATHAS_IMAGE_LIMITS;
  let count = 0;
  let total = 0;
  const fitted = [...messages];
  for (let index = fitted.length - 1; index >= 0; index--) {
    const message = fitted[index];
    if (message.role !== "user" || !message.images?.length) continue;
    const kept: ImageContent[] = [];
    for (const image of [...message.images].reverse()) {
      const bytes = decodedBytes(image.data);
      if (
        !limits.mediaTypes.includes(image.mediaType.toLowerCase()) ||
        bytes > limits.maxImageBytes ||
        count + 1 > limits.maxImages ||
        total + bytes > limits.maxTotalBytes
      )
        continue;
      count += 1;
      total += bytes;
      kept.unshift(image);
    }
    if (kept.length === message.images.length) continue;
    const { images, ...rest } = message;
    fitted[index] = withOmittedNote(
      kept.length ? { ...rest, images: kept } : rest,
      images.length - kept.length,
      "over the image size or count limit",
    );
  }
  return fitted;
}

function capMessage<T extends AIMessage>(message: T, maxChars: number): T {
  if (message.content.length <= maxChars) return message;
  return {
    ...message,
    content: truncateTextToTokens(message.content, Math.floor(maxChars / 4)).text,
  };
}

/**
 * Fits a full request (system prompt first, current user message last) to what the provider
 * accepts: images are dropped for text-only models (and kept within Athas's image limits
 * otherwise), oversized messages are truncated, and the oldest turns are summarised away until
 * the count and size limits hold.
 */
export function fitMessagesToProviderLimits(
  messages: AIMessage[],
  providerId: string,
  limits: ProviderRequestLimits | null = getProviderRequestLimits(providerId),
  acceptsImages = providerAcceptsImages(providerId),
): AIMessage[] {
  let fitted = !acceptsImages
    ? messages.map(withoutImages)
    : providerId === "athas"
      ? withinHostedImageLimits(messages)
      : messages;
  if (!limits) return fitted;
  fitted = fitted.map((message) => capMessage(message, limits.maxMessageChars));
  if (fitted.length <= limits.maxMessages && byteLength(fitted) <= limits.maxBytes) return fitted;

  let system = fitted[0]?.role === "system" ? fitted[0] : null;
  const conversation = fitted.slice(system ? 1 : 0);
  let current = conversation.pop();
  if (!current) return fitted;

  // The system prompt and the new message always go out; shrink them when they alone are too
  // large, the system prompt first since it holds the most expendable context.
  const summaryReserve = MAX_SUMMARY_CHARS * 2;
  const baseBytes = () => byteLength([...(system ? [system] : []), current as AIMessage]);
  const baseLimit = limits.maxBytes - summaryReserve;
  if (system && baseBytes() > baseLimit) {
    const excess = baseBytes() - baseLimit;
    system = capMessage(system, Math.max(1_000, system.content.length - excess * 2));
  }
  if (baseBytes() > baseLimit) {
    const excess = baseBytes() - baseLimit;
    current = capMessage(current, Math.max(1_000, current.content.length - excess * 2));
  }

  const head = system ? [system] : [];
  const assemble = (history: AIMessage[]) => [...head, ...history, current as AIMessage];
  const fits = (from: number) => {
    const kept = conversation.slice(from);
    return (
      head.length + kept.length + 2 <= limits.maxMessages &&
      byteLength(assemble(kept)) + summaryReserve <= limits.maxBytes
    );
  };
  let start = 0;
  while (start < conversation.length && !fits(start)) start++;
  while (start < conversation.length && conversation[start].role !== "user") start++;

  const dropped = conversation.slice(0, start);
  if (dropped.length === 0) return assemble(conversation);
  const summary = formatSummary(summarizeConversationExtractively(dropped), dropped.length);
  const kept = conversation.slice(start);
  if (kept.length === 0) {
    return [...head, { ...current, content: `${summary}\n\n${current.content}` }];
  }
  return assemble(prependSummary(kept, summary));
}
