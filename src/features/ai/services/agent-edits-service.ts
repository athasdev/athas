import {
  computeAgentHunks,
  keepHunk,
  rebaseOnDisk,
  recordAgentWrite,
  rejectEdit,
  transferLineEdits,
} from "@/features/ai/lib/agent-edit-hunks";
import { getAgentEditEntries, useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import type {
  AgentEditEntry,
  AgentEditHunk,
  AgentFileWrite,
} from "@/features/ai/types/agent-edits.types";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import {
  deleteFileOrDirectory,
  readFileContent,
} from "@/features/file-system/controllers/file-operations";
import { writeFile } from "@/features/file-system/controllers/platform";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { showToast } from "@/features/layout/contexts/toast-context";
import { showConfirmDialog } from "@/ui/dialog";
import { getBaseName } from "@/utils/path-helpers";

/** Long enough for the chat to have heard about an agent write before the disk is compared. */
const RECONCILE_DELAY_MS = 300;

const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
let listening = false;

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
    return await readFileContent(path);
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
      for (const chatId of chatsTracking(path)) void syncWithDisk(chatId, path);
    }, RECONCILE_DELAY_MS),
  );
}

function listenForFileChanges() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Fired for every change the file watcher reports, including the user's own saves.
  window.addEventListener("file-external-change", (event) => {
    const path = (event as CustomEvent<{ path?: string }>).detail?.path;
    if (path) scheduleAgentEditsDiskCheck(path);
  });
}

/** Adds an `agent_file_write` to the chat's log. The write itself already landed. */
export function recordAgentFileWrite(chatId: string, write: AgentFileWrite) {
  listenForFileChanges();
  const existing = getAgentEditEntries(chatId)[write.path];
  const { entry, lostEarlierReview } = recordAgentWrite(existing, write);
  setEntry(chatId, write.path, entry);
  if (lostEarlierReview) {
    notifyDropped(
      write.path,
      "It changed where the agent had edited it before; earlier agent changes count as kept.",
    );
  }
}

function findEditorBuffer(path: string) {
  const buffer = getBufferByPath(useBufferStore.getState().buffers, path);
  return buffer?.type === "editor" ? buffer : null;
}

/** Writes review results to disk without the file watcher treating them as outside changes. */
async function writeReviewed(path: string, content: string) {
  useFileWatcherStore.getState().actions.markPendingSave(path);
  await writeFile(path, content);
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
      if (buffer) useBufferStore.getState().actions.closeBufferForce(buffer.id);
      await deleteFileOrDirectory(entry.path);
      return;
    }
    await writeReviewed(entry.path, reverted);
  } catch (error) {
    setEntry(chatId, entry.path, entry);
    showToast({ type: "error", message: `Could not reject the change in ${name}: ${error}` });
    return;
  }

  if (!buffer) return;
  const { updateBufferContent } = useBufferStore.getState().actions;
  updateBufferContent(buffer.id, reverted, false);
  if (unsaved !== null) updateBufferContent(buffer.id, bufferText, true);
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
        candidate.currentLines.join("\n") === hunk.currentLines.join("\n"),
    ) ?? null
  );
}

export async function keepAgentHunk(chatId: string, path: string, hunk: AgentEditHunk) {
  const entry = await syncWithDisk(chatId, path);
  const current = entry && findHunk(entry, hunk);
  if (entry && current) keepHunks(chatId, entry, [current]);
}

export async function rejectAgentHunk(chatId: string, path: string, hunk: AgentEditHunk) {
  const entry = await syncWithDisk(chatId, path);
  const current = entry && findHunk(entry, hunk);
  if (entry && current) await rejectHunks(chatId, entry, [current]);
}

export async function keepAgentFile(chatId: string, path: string) {
  const entry = await syncWithDisk(chatId, path);
  if (entry) keepHunks(chatId, entry, computeAgentHunks(entry.baseline, entry.current));
}

export async function rejectAgentFile(chatId: string, path: string) {
  const entry = await syncWithDisk(chatId, path);
  if (entry) await rejectHunks(chatId, entry, computeAgentHunks(entry.baseline, entry.current));
}

export async function keepAllAgentEdits(chatId: string) {
  for (const path of Object.keys(getAgentEditEntries(chatId))) await keepAgentFile(chatId, path);
}

export async function rejectAllAgentEdits(chatId: string) {
  for (const path of Object.keys(getAgentEditEntries(chatId))) await rejectAgentFile(chatId, path);
}
