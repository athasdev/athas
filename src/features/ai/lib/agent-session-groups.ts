import type { ChatSession, Message } from "@/features/ai/types/ai-chat.types";

export interface AgentSessionGroup<T extends ChatSession = ChatSession> {
  id: "today" | "yesterday" | "week" | "month" | "older";
  label: string;
  chats: T[];
}

const GROUPS: readonly Omit<AgentSessionGroup, "chats">[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Previous 7 days" },
  { id: "month", label: "Previous 30 days" },
  { id: "older", label: "Older" },
];

const DAY_MS = 86_400_000;

function groupIdFor(date: Date, startOfToday: number): AgentSessionGroup["id"] {
  const time = date.getTime();
  if (time >= startOfToday) return "today";
  if (time >= startOfToday - DAY_MS) return "yesterday";
  if (time >= startOfToday - 7 * DAY_MS) return "week";
  if (time >= startOfToday - 30 * DAY_MS) return "month";
  return "older";
}

/**
 * Splits sessions, already in display order, by when they were last active, so a long history
 * reads as a timeline. Empty groups are left out.
 */
export function groupAgentSessionsByActivity<T extends ChatSession>(
  chats: readonly T[],
  now: Date = new Date(),
): AgentSessionGroup<T>[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const byGroup = new Map<AgentSessionGroup["id"], T[]>();
  for (const chat of chats) {
    const id = groupIdFor(chat.lastMessageAt, startOfToday);
    const group = byGroup.get(id);
    if (group) group.push(chat);
    else byGroup.set(id, [chat]);
  }
  return GROUPS.flatMap((group) => {
    const groupChats = byGroup.get(group.id);
    return groupChats ? [{ ...group, chats: groupChats }] : [];
  });
}

/** Whether the agent is still writing its latest reply, given the session's messages. */
export function isAgentSessionWorking(messages: readonly Message[] | undefined): boolean {
  return messages?.[messages.length - 1]?.isStreaming === true;
}
