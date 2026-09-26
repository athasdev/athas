/**
 * One run of changed lines between two texts: `baseLines` at `baseStart` in the older text were
 * replaced by `currentLines` at `currentStart` in the newer one. Starts are 0-based line indexes.
 */
export interface AgentEditHunk {
  baseStart: number;
  baseLines: string[];
  currentStart: number;
  currentLines: string[];
}

/** Replace `deleteCount` lines at the 0-based `start` with `lines`. */
export interface LineEdit {
  start: number;
  deleteCount: number;
  lines: string[];
}

/**
 * A file the agent wrote through `fs/write_text_file` that still has unreviewed changes. The
 * hunks to review are the difference between `baseline` and `current`: keeping one moves it into
 * the baseline, rejecting one takes it back out of the file.
 */
export interface AgentEditEntry {
  path: string;
  /** The file before the agent's first unreviewed write, plus every change kept since. */
  baseline: string;
  /** What the file holds now, as far as the log knows: the agent's last write. */
  current: string;
  /** The agent created the file, so rejecting all of it deletes the file again. */
  created: boolean;
  /** Bumped on every change, so a disk read that raced a newer write can be told apart. */
  revision: number;
}

/** The `agent_file_write` event, as the log records it. */
export interface AgentFileWrite {
  /** The id Rust gave the write; the `file-changed` event it causes carries the same id. */
  writeId?: number;
  path: string;
  previousContent: string | null;
  content: string;
}
