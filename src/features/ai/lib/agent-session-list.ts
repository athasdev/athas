import { filterChatsByWorkspace } from "@/features/ai/lib/ai-workspace-scope";
import type { Chat } from "@/features/ai/types/ai-chat.types";

/**
 * `createChat` stamps `createdAt` and `lastMessageAt` from two separate clock
 * reads, so historical rows can be a hair apart without ever holding a message.
 */
const CREATION_SKEW_MS = 1000;

type SessionSummary = Pick<Chat, "createdAt" | "lastMessageAt"> & Partial<Pick<Chat, "messages">>;

/**
 * Whether a session has ever carried a message.
 *
 * List views load chat metadata without messages, so `messages` is empty for
 * most rows and cannot be trusted on its own. `lastMessageAt` is only advanced
 * by message mutations, which makes it the reliable signal here.
 */
export function hasAgentSessionActivity(chat: SessionSummary): boolean {
  if ((chat.messages?.length ?? 0) > 0) return true;

  return chat.lastMessageAt.getTime() - chat.createdAt.getTime() > CREATION_SKEW_MS;
}

export interface AgentSessionListOptions {
  workspacePath?: string | null;
  /** Sessions that stay listed even while still empty, e.g. the open one. */
  keepIds?: Iterable<string | null | undefined>;
  /** `true` mixes archived sessions in, `"only"` returns just those. */
  includeArchived?: boolean | "only";
  /**
   * Keep sessions that never received a message. Navigation fallbacks want
   * this — landing on an untouched session beats landing on nothing — while
   * list surfaces do not.
   */
  includeEmpty?: boolean;
  includePinned?: boolean;
}

/**
 * The single ordering and visibility rule behind every agent session list.
 *
 * Sessions that never received a message are hidden: they are created eagerly
 * by "New Agent" and would otherwise pile up as identical "New Session" rows.
 */
export function selectAgentSessions(
  chats: Chat[],
  {
    workspacePath,
    keepIds,
    includeArchived = false,
    includePinned = true,
    includeEmpty = false,
  }: AgentSessionListOptions = {},
): Chat[] {
  const kept = new Set<string>();
  for (const id of keepIds ?? []) {
    if (id) kept.add(id);
  }

  return filterChatsByWorkspace(chats, workspacePath)
    .filter((chat) => {
      if (includeArchived === "only") {
        return Boolean(chat.archivedAt) && (includeEmpty || hasAgentSessionActivity(chat));
      }
      if (kept.has(chat.id)) return true;
      if (!includeArchived && chat.archivedAt) return false;
      if (!includePinned && chat.isPinned) return false;
      return includeEmpty || hasAgentSessionActivity(chat);
    })
    .sort((left, right) => {
      if (Boolean(left.isPinned) !== Boolean(right.isPinned)) return left.isPinned ? -1 : 1;
      return right.lastMessageAt.getTime() - left.lastMessageAt.getTime();
    });
}
