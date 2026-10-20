import type { Message } from "@/features/ai/types/ai-chat.types";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord =>
  value && typeof value === "object" ? (value as JsonRecord) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asSeconds = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

function userText(item: JsonRecord): string {
  return asArray(item.content)
    .map((input) => {
      const part = asRecord(input);
      return part.type === "text" && typeof part.text === "string" ? part.text : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Turns a `thread/read` answer with its turns into chat messages: each user message stays one
 * message, and the agent messages of a turn join into the answer that follows it. Tool calls,
 * reasoning and file changes are left out; the thread keeps them for when it resumes.
 */
export function codexThreadToMessages(
  value: unknown,
  createId: () => string = () => crypto.randomUUID(),
): Message[] {
  const thread = asRecord(asRecord(value).thread);
  const threadTime = asSeconds(thread.updatedAt) ?? asSeconds(thread.createdAt);
  const messages: Message[] = [];

  for (const entry of asArray(thread.turns)) {
    const turn = asRecord(entry);
    const startedAt = asSeconds(turn.startedAt) ?? threadTime;
    const endedAt = asSeconds(turn.completedAt) ?? startedAt;
    const at = (seconds: number | null) => new Date((seconds ?? 0) * 1000);
    const answer: string[] = [];

    for (const raw of asArray(turn.items)) {
      const item = asRecord(raw);
      if (item.type === "userMessage") {
        const content = userText(item);
        if (content) {
          messages.push({ id: createId(), role: "user", content, timestamp: at(startedAt) });
        }
      } else if (item.type === "agentMessage" && typeof item.text === "string" && item.text) {
        answer.push(item.text);
      }
    }

    if (answer.length > 0) {
      messages.push({
        id: createId(),
        role: "assistant",
        content: answer.join("\n\n"),
        timestamp: at(endedAt),
      });
    }
  }

  return messages;
}
