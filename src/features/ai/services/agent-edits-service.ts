import {
  computeAgentHunks,
  keepHunk,
  rebaseOnDisk,
  recordAgentWrite,
  rejectEdit,
  transferLineEdits,
} from "@/features/ai/lib/agent-edit-hunks";
import {
  currentTurnMessageId,
  recordCheckpointAgentWrite,
} from "@/features/ai/services/agent-checkpoints-service";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import type {
  AgentEditEntry,
  AgentEditHunk,
  AgentFileWrite,
} from "@/features/ai/types/agent-edits.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { showToast } from "@/features/layout/contexts/toast-context";
import { showConfirmDialog } from "@/ui/dialog";
import { getBaseName } from "@/utils/path-helpers";

/** Gathers the file watcher's burst of events for one change into one disk check. */
const RECONCILE_DELAY_MS = 150;
/**
 * How long a `file-changed` from an agent write waits for a chat to record that write. Rust
 * sends `agent_file_write` first, so a chat that records it has done so by then; a write no chat
 * records (its chat is not open) is then compared with the disk like any other change.
 */
const UNCLAIMED_WRITE_TIMEOUT_MS = 2000;
const MAX_REMEMBERED_WRITES = 500;

const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const reviewTasks = new Map<string, Promise<void>>();

function reviewFile(path: string, task: () => Promise<void>): Promise<void> {
  const previous = reviewTasks.get(path) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  reviewTasks.set(path, next);
  void next
    .finally(() => {
      if (reviewTasks.get(path) === next) reviewTasks.delete(path);
    })
    .catch(() => undefined);
  return next;
}
/** Agent writes a chat recorded, by write id. */
const recordedWrites = new Set<number>();
/** Agent writes whose `file-changed` came before any chat recorded them, by write id. */
const unclaimedWrites = new Map<number, { path: string; timer: ReturnType<typeof setTimeout> }>();
let listening = false;

function hasUnclaimedWrite(path: string): boolean {
  for (const write of unclaimedWrites.values()) if (write.path === path) return true;
  return false;
}

function setEntry(chatId: string, path: string, entry: AgentEditEntry | null) {
  const resolved = entry && entry.baseline === entry.current ? null : entry;
  useAgentEditsStore.getState().actions.setEntry(chatId, path, resolved);
}

function notifyDropped(path: string, reason: string) {
  showToast({
    key: `agent-edits-dropped:${path}`,
    type: "warning",
    message: `Stopped tracking agent changes to ${getBaseName(path)}`,
    description: reason,
  });
}

async function readDisk(path: string): Promise<string | null> {
  try {
    return await getWorkspaceResourceProvider(path).readText(path);
  } catch {
    return null;
  }
}

/**
 * Checks one chat's entry for `path` against the disk. A change the agent did not make is
 * rebased when it stays clear of the agent's hunks; otherwise, or when the file is gone, the
 * entry is dropped with a notice rather than risk reverting the wrong lines later.
 */
async function syncWithDisk(chatId: string, path: string): Promise<AgentEditEntry | null> {
  const before = getAgentEditEntries(chatId)[path];
  if (!before) return null;
  // The disk holds an agent write no chat has recorded yet; its record brings the log up to
  // date, and comparing now would take the agent's change for someone else's.
  if (hasUnclaimedWrite(path)) return before;
  const disk = await readDisk(path);
  const entry = getAgentEditEntries(chatId)[path];
  // A newer agent write or review landed while the disk was read; its own check follows.
  if (!entry || entry.revision !== before.revision) return entry ?? null;
  if (disk === entry.current) return entry;

  if (disk === null) {
    setEntry(chatId, path, null);
    notifyDropped(path, "The file was deleted or can no longer be read.");
    return null;
  }
  const rebased = rebaseOnDisk(entry, disk);
  if (!rebased) {
    setEntry(chatId, path, null);
    notifyDropped(path, "It was changed outside Athas where the agent had edited it.");
    return null;
  }
  setEntry(chatId, path, rebased);
  return getAgentEditEntries(chatId)[path] ?? null;
}

function chatsTracking(path: string): string[] {
  const { byChat } = useAgentEditsStore.getState();
  return Object.keys(byChat).filter((chatId) => byChat[chatId][path]);
}

/** Compares every chat's entry for `path` with the disk, shortly after the file changed. */
export function scheduleAgentEditsDiskCheck(path: string) {
  if (chatsTracking(path).length === 0) return;
  clearTimeout(reconcileTimers.get(path));
  reconcileTimers.set(
    path,
    setTimeout(() => {
      reconcileTimers.delete(path);
      void reviewFile(path, async () => {
        for (const chatId of chatsTracking(path)) await syncWithDisk(chatId, path);
      });
    }, RECONCILE_DELAY_MS),
  );
}

function listenForFileChanges() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Fired for every change the file watcher reports, including the user's own saves.
  window.addEventListener("file-external-change", (event) => {
    const detail = (event as CustomEvent<{ path?: string; agentWriteId?: number }>).detail;
    if (!detail?.path) return;
    const { path, agentWriteId } = detail;
    if (agentWriteId !== undefined) {
      // The change is that agent write; a chat that recorded it already has it in its log.
      if (recordedWrites.has(agentWriteId)) return;
      const timer = setTimeout(() => {
        unclaimedWrites.delete(agentWriteId);
        scheduleAgentEditsDiskCheck(path);
      }, UNCLAIMED_WRITE_TIMEOUT_MS);
      unclaimedWrites.set(agentWriteId, { path, timer });
      return;
    }
    scheduleAgentEditsDiskCheck(path);
  });
}

function rememberRecordedWrite(writeId: number | undefined) {
  if (writeId === undefined) return;
  const unclaimed = unclaimedWrites.get(writeId);
  if (unclaimed) {
    clearTimeout(unclaimed.timer);
    unclaimedWrites.delete(writeId);
  }
  recordedWrites.add(writeId);
  if (recordedWrites.size > MAX_REMEMBERED_WRITES) {
    const oldest = recordedWrites.values().next().value;
    if (oldest !== undefined) recordedWrites.delete(oldest);
  }
}

/**
 * Brings the other chats tracking `path` up to date with `content`, which one chat's agent wrote
 * or one chat's review left on disk. Each chat's log holds only its own agent's changes: another
 * chat's write moves into the baseline where it is clear of this chat's hunks, so they stay
 * reviewable here and the other change is reviewed in its own chat. Where the two overlap the
 * later change wins and this chat stops tracking the file, saying why. This runs right away
 * instead of waiting for the file watcher, which does not report review writes at all.
 */
function rebaseOtherChats(path: string, exceptChatId: string, content: string | null) {
  for (const chatId of chatsTracking(path)) {
    if (chatId === exceptChatId) continue;
    const entry = getAgentEditEntries(chatId)[path];
    if (!entry || entry.current === content) continue;
    const rebased = content === null ? null : rebaseOnDisk(entry, content);
    setEntry(chatId, path, rebased);
    if (!rebased) {
      notifyDropped(
        path,
        content === null
          ? "Another chat's review deleted the file."
          : "Another chat's agent changed the lines this chat's agent had edited.",
      );
    }
  }
}

/**
 * Adds an `agent_file_write` to the chat's log, and to the checkpoint of the turn it belongs to.
 * The write itself already landed.
 */
export function recordAgentFileWrite(chatId: string, write: AgentFileWrite) {
  listenForFileChanges();
  rememberRecordedWrite(write.writeId);
  const turnId = write.turnId ?? currentTurnMessageId(chatId) ?? undefined;
  if (turnId) void recordCheckpointAgentWrite(chatId, turnId, write);
  const existing = getAgentEditEntries(chatId)[write.path];
  const { entry, lostEarlierReview } = recordAgentWrite(existing, { ...write, turnId });
  setEntry(chatId, write.path, entry);
  if (lostEarlierReview) {
    notifyDropped(
      write.path,
      "It changed where the agent had edited it before; earlier agent changes count as kept.",
    );
  }
  rebaseOtherChats(write.path, chatId, write.content);
}

/**
 * Adds a file the agent deleted to the checkpoint of its turn, so restoring the turn brings the
 * file back. There is nothing left to review, so the chat stops tracking the file; other chats
 * notice the deletion through the file watcher.
 */
export function recordAgentFileDelete(
  chatId: string,
  deletion: { path: string; previousContent: string; turnId?: string },
) {
  listenForFileChanges();
  const turnId = deletion.turnId ?? currentTurnMessageId(chatId) ?? undefined;
  if (turnId) {
    void recordCheckpointAgentWrite(chatId, turnId, {
      path: deletion.path,
      previousContent: deletion.previousContent,
      content: null,
    });
  }
  setEntry(chatId, deletion.path, null);
}

/**
 * The user message whose turn the chat's agent is running now. An agent that resolves it when
 * its run starts keeps its writes with that turn even if they land after the user stopped it and
 * sent the next prompt.
 */
export function currentAgentTurnId(chatId: string): string | undefined {
  return currentTurnMessageId(chatId) ?? undefined;
}

function findEditorBuffer(path: string) {
  const buffer = getBufferByPath(useBufferStore.getState().buffers, path);
  return buffer?.type === "editor" ? buffer : null;
}

/** Writes review results to disk without the file watcher treating them as outside changes. */
async function writeReviewed(path: string, content: string, expectedContent: string) {
  useFileWatcherStore.getState().actions.markPendingSave(path);
  await getWorkspaceResourceProvider(path).writeText(path, content, expectedContent);
  emitGitChanged({ filePath: path, scopes: ["working-tree"], source: "agent-edit-review" });
}

/**
 * Takes hunks back out of the file. The disk gets the reverted text right away. An open editor
 * with unsaved edits gets the same revert applied on top of them when they are clear of the
 * reverted lines; when they overlap, nothing changes and the user is told why, since guessing
 * would lose either their edit or the revert. Rejecting all of a file the agent created deletes
 * it; when its editor has unsaved edits the user confirms discarding them first.
 */
async function rejectHunks(chatId: string, entry: AgentEditEntry, hunks: AgentEditHunk[]) {
  if (hunks.length === 0) return;
  const name = getBaseName(entry.path);
  const edits = hunks.map(rejectEdit);
  const reverted = transferLineEdits(entry.current, entry.current, edits);
  if (reverted === null) return;

  const buffer = findEditorBuffer(entry.path);
  const originalBufferContent = buffer?.content;
  const unsaved = buffer?.isDirty ? buffer.content : null;
  const removesFile = entry.created && reverted === "";
  if (removesFile && unsaved !== null) {
    const confirmed = await showConfirmDialog(
      `${name} has unsaved edits. Discard them and delete the file the agent created?`,
      { title: "Delete agent-created file", confirmLabel: "Discard and delete" },
    );
    // The agent may have written the file again while the user decided.
    if (!confirmed || getAgentEditEntries(chatId)[entry.path]?.revision !== entry.revision) return;
  }
  const bufferText =
    unsaved === null || removesFile ? reverted : transferLineEdits(entry.current, unsaved, edits);
  if (bufferText === null) {
    showToast({
      type: "warning",
      message: `Could not reject the change in ${name}`,
      description: "Your unsaved edits overlap it. Save or undo them, then reject again.",
    });
    return;
  }

  setEntry(chatId, entry.path, { ...entry, current: reverted, revision: entry.revision + 1 });
  try {
    if (removesFile) {
      useFileWatcherStore.getState().actions.markPendingSave(entry.path);
      await getWorkspaceResourceProvider(entry.path).deleteText(entry.path, entry.current);
      if (getAgentEditEntries(chatId)[entry.path]) return;
      const latestBuffer = findEditorBuffer(entry.path);
      if (
        buffer &&
        latestBuffer?.id === buffer.id &&
        latestBuffer.content === originalBufferContent
      )
        useBufferStore.getState().actions.closeBufferForce(buffer.id);
      rebaseOtherChats(entry.path, chatId, null);
      return;
    }
    await writeReviewed(entry.path, reverted, entry.current);
    const latestEntry = getAgentEditEntries(chatId)[entry.path];
    if (latestEntry && latestEntry.revision !== entry.revision + 1) return;
    rebaseOtherChats(entry.path, chatId, reverted);
  } catch (error) {
    useFileWatcherStore.getState().actions.clearPendingSave(entry.path);
    const latest = getAgentEditEntries(chatId)[entry.path];
    if (!latest || latest.revision === entry.revision + 1) setEntry(chatId, entry.path, entry);
    showToast({ type: "error", message: `Could not reject the change in ${name}: ${error}` });
    return;
  }

  const latestBuffer = findEditorBuffer(entry.path);
  if (!latestBuffer || latestBuffer.readOnly) return;
  const latestText = latestBuffer.isDirty
    ? transferLineEdits(entry.current, latestBuffer.content, edits)
    : reverted;
  if (latestText === null) {
    showToast({
      type: "warning",
      message: "The file was reverted on disk. Newer unsaved edits were kept in the editor.",
    });
    return;
  }
  const { updateBufferContent } = useBufferStore.getState().actions;
  updateBufferContent(latestBuffer.id, reverted, false);
  if (latestBuffer.isDirty && latestText !== reverted)
    updateBufferContent(latestBuffer.id, latestText, true);
}

function keepHunks(chatId: string, entry: AgentEditEntry, hunks: AgentEditHunk[]) {
  // Keep from the bottom up so earlier hunks keep their line numbers.
  let baseline = entry.baseline;
  for (const hunk of [...hunks].sort((a, b) => b.baseStart - a.baseStart)) {
    const kept = keepHunk({ ...entry, baseline }, hunk);
    if (kept === null) return;
    baseline = kept;
  }
  setEntry(chatId, entry.path, { ...entry, baseline, revision: entry.revision + 1 });
}

/** The hunk as it stands after syncing, or null when it is gone or moved. */
function findHunk(entry: AgentEditEntry, hunk: AgentEditHunk): AgentEditHunk | null {
  return (
    computeAgentHunks(entry.baseline, entry.current).find(
      (candidate) =>
        candidate.baseStart === hunk.baseStart &&
        candidate.currentStart === hunk.currentStart &&
        candidate.baseLines.length === hunk.baseLines.length &&
        candidate.baseLines.every((line, index) => line === hunk.baseLines[index]) &&
        candidate.currentLines.length === hunk.currentLines.length &&
        candidate.currentLines.every((line, index) => line === hunk.currentLines[index]),
    ) ?? null
  );
}

export async function keepAgentHunk(chatId: string, path: string, hunk: AgentEditHunk) {
  await reviewFile(path, async () => {
    const entry = await syncWithDisk(chatId, path);
    const current = entry && findHunk(entry, hunk);
    if (entry && current) keepHunks(chatId, entry, [current]);
  });
}

export async function rejectAgentHunk(chatId: string, path: string, hunk: AgentEditHunk) {
  await reviewFile(path, async () => {
    const entry = await syncWithDisk(chatId, path);
    const current = entry && findHunk(entry, hunk);
    if (entry && current) await rejectHunks(chatId, entry, [current]);
  });
}

export async function keepAgentFile(chatId: string, path: string) {
  await reviewFile(path, async () => {
    const entry = await syncWithDisk(chatId, path);
    if (entry) keepHunks(chatId, entry, computeAgentHunks(entry.baseline, entry.current));
  });
}

export async function rejectAgentFile(chatId: string, path: string) {
  await reviewFile(path, async () => {
    const entry = await syncWithDisk(chatId, path);
    if (entry) await rejectHunks(chatId, entry, computeAgentHunks(entry.baseline, entry.current));
  });
}

export async function keepAllAgentEdits(chatId: string) {
  for (const path of Object.keys(getAgentEditEntries(chatId))) await keepAgentFile(chatId, path);
}

export async function rejectAllAgentEdits(chatId: string) {
  for (const path of Object.keys(getAgentEditEntries(chatId))) await rejectAgentFile(chatId, path);
}

/** Shows the chat's unreviewed changes in the "Agent Changes" tab, opening it if needed. */
export function openAgentEditsReview(chatId: string) {
  useAgentEditsStore.getState().actions.openReview(chatId);
  useBufferStore.getState().actions.openContent({ type: "agentChanges" });
}
