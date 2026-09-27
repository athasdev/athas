/** One file an agent wrote during a turn: how it was before the turn's first write, and after. */
export interface AgentCheckpointFile {
  path: string;
  /** The file before the agent first wrote it this turn; null when it did not exist. */
  before: string | null;
  /** The file after the agent's last write this turn; null when the agent deleted it. */
  after: string | null;
}

/**
 * The files one user turn's agent changed, so the chat can go back to before that turn. A turn
 * is named by the user message that started it.
 */
export interface AgentCheckpoint {
  messageId: string;
  /** When the agent first wrote a file during the turn, in epoch milliseconds. */
  createdAt: number;
  files: Record<string, AgentCheckpointFile>;
}

/** A chat's checkpoints, oldest first, as they are kept and persisted. */
export interface ChatCheckpoints {
  checkpoints: AgentCheckpoint[];
  /**
   * The `createdAt` of the newest checkpoint dropped to stay within the storage budget. Turns
   * from before then can no longer be restored, since their files were not all kept.
   */
  truncatedAt: number | null;
}

/** What `listCheckpoints` reports for one turn. */
export interface AgentCheckpointSummary {
  messageId: string;
  createdAt: number;
  files: Array<{ path: string; created: boolean; deleted: boolean }>;
}

/** One file a restore would change, with what it becomes and what the log expects it to hold. */
export interface CheckpointRestoreFile {
  path: string;
  /** The content before the earliest restored turn wrote it; null means the file goes away. */
  target: string | null;
  /** What the latest restored turn left in the file; anything else is someone else's change. */
  expected: string | null;
}

export interface CheckpointRestorePlan {
  /** The turns being undone, oldest first. */
  messageIds: string[];
  files: CheckpointRestoreFile[];
}

export type CheckpointRestoreResult =
  | { status: "restored"; restoredPaths: string[]; failedPaths: string[] }
  /** The user declined to discard changes made after the agent's. */
  | { status: "cancelled" }
  /** Nothing the agent wrote at or after that message is left to restore. */
  | { status: "nothing-to-restore" }
  /** The message predates the checkpoints still kept for the chat. */
  | { status: "unavailable" };
