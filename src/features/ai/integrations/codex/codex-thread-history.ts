import { invoke } from "@tauri-apps/api/core";
import { coalesceAssistantResponses } from "@/features/ai/lib/assistant-response";
import type { Message } from "@/features/ai/types/ai-chat.types";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asTimestamp(value: unknown, fallback: Date): Date {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : fallback;
}

function normalizeUserMessage(item: Record<string, unknown>, timestamp: Date): Message | null {
  const content = Array.isArray(item.content)
    ? item.content
        .map(asRecord)
        .filter((part) => part.type === "text")
        .map((part) => asString(part.text))
        .filter(Boolean)
        .join("\n")
    : "";

  if (!content) return null;

  return {
    id: asString(item.id) || crypto.randomUUID(),
    content,
    role: "user",
    timestamp,
  };
}

function normalizeAgentMessage(item: Record<string, unknown>, timestamp: Date): Message | null {
  const content = asString(item.text);
  if (!content) return null;

  return {
    id: asString(item.id) || crypto.randomUUID(),
    content,
    role: "assistant",
    timestamp,
  };
}

export function normalizeCodexThreadMessages(value: unknown): Message[] {
  const thread = asRecord(asRecord(value).thread);
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  const createdAt = asTimestamp(thread.createdAt, new Date(0));
  const messages: Message[] = [];

  for (const value of turns) {
    const turn = asRecord(value);
    const userTimestamp = asTimestamp(turn.startedAt, createdAt);
    const assistantTimestamp = asTimestamp(turn.completedAt, userTimestamp);
    const items = Array.isArray(turn.items) ? turn.items : [];

    for (const value of items) {
      const item = asRecord(value);
      const message =
        item.type === "userMessage"
          ? normalizeUserMessage(item, userTimestamp)
          : item.type === "agentMessage"
            ? normalizeAgentMessage(item, assistantTimestamp)
            : null;

      if (message) messages.push(message);
    }
  }

  return coalesceAssistantResponses(messages);
}

export async function readCodexThreadMessages(threadId: string): Promise<Message[]> {
  const result = await invoke("read_codex_thread", { threadId });
  return normalizeCodexThreadMessages(result);
}
