import type {
  AgentCheckpoint,
  AgentCheckpointSummary,
  ChatCheckpoints,
  CheckpointRestorePlan,
} from "@/features/ai/types/agent-checkpoints.types";

/** At most this many turns are kept per chat; older ones are dropped first. */
const MAX_CHECKPOINTS_PER_CHAT = 50;
/** At most this many characters of file snapshots are kept per chat. */
const MAX_CHECKPOINT_CHARS_PER_CHAT = 4_000_000;

export const EMPTY_CHAT_CHECKPOINTS: ChatCheckpoints = { checkpoints: [], truncatedAt: null };

export interface CheckpointWrite {
  path: string;
  /** The file before this write; null when it did not exist. */
  previousContent: string | null;
  /** The file after this write; null when the write deleted it. */
  content: string | null;
}

function checkpointSize(checkpoint: AgentCheckpoint): number {
  let size = 0;
  for (const file of Object.values(checkpoint.files)) {
    size += (file.before?.length ?? 0) + (file.after?.length ?? 0) + file.path.length;
  }
  return size;
}

/**
 * Drops the oldest checkpoints until the chat is within the count and size budgets. The newest
 * checkpoint always stays, so the turn in progress can be undone even when it is large.
 */
export function trimCheckpoints(
  state: ChatCheckpoints,
  maxCount = MAX_CHECKPOINTS_PER_CHAT,
  maxChars = MAX_CHECKPOINT_CHARS_PER_CHAT,
): ChatCheckpoints {
  const { checkpoints } = state;
  let total = checkpoints.reduce((sum, checkpoint) => sum + checkpointSize(checkpoint), 0);
  let drop = 0;
  while (
    drop < checkpoints.length - 1 &&
    (checkpoints.length - drop > maxCount || total > maxChars)
  ) {
    total -= checkpointSize(checkpoints[drop]);
    drop += 1;
  }
  if (drop === 0) return state;
  return {
    checkpoints: checkpoints.slice(drop),
    truncatedAt: Math.max(state.truncatedAt ?? 0, checkpoints[drop - 1].createdAt),
  };
}

/**
 * Adds an agent write to the checkpoint of the turn `messageId` started. The first write to a
 * file in a turn fixes what the file goes back to; every write moves what the turn left in it.
 */
export function recordCheckpointWrite(
  state: ChatCheckpoints,
  messageId: string,
  write: CheckpointWrite,
  now: number,
): ChatCheckpoints {
  const index = state.checkpoints.findIndex((checkpoint) => checkpoint.messageId === messageId);
  const existing: AgentCheckpoint =
    index >= 0 ? state.checkpoints[index] : { messageId, createdAt: now, files: {} };
  const previous = existing.files[write.path];
  const checkpoint: AgentCheckpoint = {
    ...existing,
    files: {
      ...existing.files,
      [write.path]: {
        path: write.path,
        before: previous ? previous.before : write.previousContent,
        after: write.content,
      },
    },
  };
  const checkpoints =
    index >= 0
      ? state.checkpoints.map((item, itemIndex) => (itemIndex === index ? checkpoint : item))
      : [...state.checkpoints, checkpoint];
  return trimCheckpoints({ ...state, checkpoints });
}

/**
 * The index of the first checkpoint a restore to before `messageId` undoes. `messageIds` is the
 * chat's message order, which places turns that wrote nothing; checkpoints whose message the chat
 * no longer has keep their place in the log. Null when nothing at or after that message wrote.
 */
function firstAffectedIndex(
  checkpoints: AgentCheckpoint[],
  messageId: string,
  messageIds: readonly string[],
): number | null {
  const target = messageIds.indexOf(messageId);
  const index = checkpoints.findIndex((checkpoint) => {
    if (checkpoint.messageId === messageId) return true;
    if (target < 0) return false;
    return messageIds.indexOf(checkpoint.messageId) >= target;
  });
  return index >= 0 ? index : null;
}

/**
 * Whether the chat can still go back to before `messageId`: false once older checkpoints were
 * dropped, since the files that turn changed may not all be known any more.
 */
export function isCheckpointAvailable(
  state: ChatCheckpoints,
  messageTimestamp: number | null,
): boolean {
  if (state.truncatedAt === null) return true;
  return messageTimestamp !== null && messageTimestamp > state.truncatedAt;
}

/**
 * What restoring the chat to before `messageId` does: each file goes back to how it was before
 * the earliest undone turn wrote it, and is expected to hold what the latest undone turn left.
 */
export function planCheckpointRestore(
  state: ChatCheckpoints,
  messageId: string,
  messageIds: readonly string[],
): CheckpointRestorePlan | null {
  const first = firstAffectedIndex(state.checkpoints, messageId, messageIds);
  if (first === null) return null;
  const undone = state.checkpoints.slice(first);
  const files = new Map<string, { target: string | null; expected: string | null }>();
  for (const checkpoint of undone) {
    for (const file of Object.values(checkpoint.files)) {
      const known = files.get(file.path);
      files.set(file.path, { target: known ? known.target : file.before, expected: file.after });
    }
  }
  const restoreFiles = [...files.entries()]
    .filter(([, file]) => file.target !== file.expected)
    .map(([path, file]) => ({ path, ...file }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (restoreFiles.length === 0) return null;
  return { messageIds: undone.map((checkpoint) => checkpoint.messageId), files: restoreFiles };
}

/** Forgets restored files and keeps failed files available for another attempt. */
export function dropRestoredCheckpoints(
  state: ChatCheckpoints,
  messageIds: readonly string[],
  failedPaths: readonly string[] = [],
): ChatCheckpoints {
  const undone = new Set(messageIds);
  const failed = new Set(failedPaths);
  return {
    ...state,
    checkpoints: state.checkpoints.flatMap((checkpoint) => {
      if (!undone.has(checkpoint.messageId)) return [checkpoint];
      const files = Object.fromEntries(
        Object.entries(checkpoint.files).filter(([path]) => failed.has(path)),
      );
      return Object.keys(files).length > 0 ? [{ ...checkpoint, files }] : [];
    }),
  };
}

export function summarizeCheckpoints(state: ChatCheckpoints): AgentCheckpointSummary[] {
  return state.checkpoints.map((checkpoint) => ({
    messageId: checkpoint.messageId,
    createdAt: checkpoint.createdAt,
    files: Object.values(checkpoint.files)
      .map((file) => ({
        path: file.path,
        created: file.before === null && file.after !== null,
        deleted: file.after === null && file.before !== null,
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  }));
}

function isCheckpointFile(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const file = value as Record<string, unknown>;
  return (
    typeof file.path === "string" &&
    (file.before === null || typeof file.before === "string") &&
    (file.after === null || typeof file.after === "string")
  );
}

/** Reads persisted checkpoints, ignoring anything malformed rather than failing the chat. */
export function parseChatCheckpoints(data: string | null | undefined): ChatCheckpoints {
  if (!data) return EMPTY_CHAT_CHECKPOINTS;
  try {
    const parsed = JSON.parse(data) as Partial<ChatCheckpoints>;
    const checkpoints = Array.isArray(parsed.checkpoints)
      ? parsed.checkpoints.filter(
          (checkpoint): checkpoint is AgentCheckpoint =>
            !!checkpoint &&
            typeof checkpoint.messageId === "string" &&
            typeof checkpoint.createdAt === "number" &&
            !!checkpoint.files &&
            typeof checkpoint.files === "object" &&
            Object.values(checkpoint.files).every(isCheckpointFile),
        )
      : [];
    const truncatedAt = typeof parsed.truncatedAt === "number" ? parsed.truncatedAt : null;
    return { checkpoints, truncatedAt };
  } catch {
    return EMPTY_CHAT_CHECKPOINTS;
  }
}
