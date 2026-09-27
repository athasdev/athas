import { invoke } from "@tauri-apps/api/core";
import {
  dropRestoredCheckpoints,
  isCheckpointAvailable,
  parseChatCheckpoints,
  planCheckpointRestore,
  recordCheckpointWrite,
  summarizeCheckpoints,
  type CheckpointWrite,
} from "@/features/ai/lib/agent-edit-checkpoints";
import { rebaseOnDisk } from "@/features/ai/lib/agent-edit-hunks";
import {
  getChatCheckpoints,
  useAgentCheckpointsStore,
} from "@/features/ai/stores/agent-checkpoints.store";
import { useAgentEditsStore } from "@/features/ai/stores/agent-edits.store";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { Message } from "@/features/ai/types/ai-chat.types";
import type {
  AgentCheckpointSummary,
  ChatCheckpoints,
  CheckpointRestorePlan,
  CheckpointRestoreResult,
} from "@/features/ai/types/agent-checkpoints.types";
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

/** Collects a turn's burst of agent writes into one save. */
const PERSIST_DELAY_MS = 400;

const loads = new Map<string, Promise<void>>();
/** Keeps each chat's loads, records and restores in order, so none reads a stale log. */
const chains = new Map<string, Promise<unknown>>();
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

function enqueue<T>(chatId: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(chatId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  chains.set(chatId, next);
  return next;
}

function findChat(chatId: string) {
  return useAIChatStore.getState().chats.find((chat) => chat.id === chatId) ?? null;
}

/**
 * The user message whose turn the chat's agent is working on: the last user message before the
 * running reply, or the chat's last user message when no reply is running.
 */
export function currentTurnMessageId(chatId: string): string | null {
  const state = useAIChatStore.getState();
  const messages = findChat(chatId)?.messages ?? [];
  const run = state.agentRuns[chatId];
  let end = messages.length;
  if (run) {
    const replyIndex = messages.findIndex((message) => message.id === run.assistantMessageId);
    if (replyIndex >= 0) end = replyIndex;
  }
  for (let index = end - 1; index >= 0; index--) {
    if (messages[index].role === "user") return messages[index].id;
  }
  return null;
}

function schedulePersist(chatId: string) {
  clearTimeout(persistTimers.get(chatId));
  persistTimers.set(
    chatId,
    setTimeout(() => {
      persistTimers.delete(chatId);
      const state = getChatCheckpoints(chatId);
      const empty = state.checkpoints.length === 0 && state.truncatedAt === null;
      invoke("save_chat_checkpoints", {
        chatId,
        data: empty ? null : JSON.stringify(state),
        updatedAt: Date.now(),
      }).catch((error) => console.warn("Could not save agent checkpoints:", error));
    }, PERSIST_DELAY_MS),
  );
}

function setCheckpoints(chatId: string, state: ChatCheckpoints) {
  useAgentCheckpointsStore.getState().actions.setChatCheckpoints(chatId, state);
  schedulePersist(chatId);
}

/** Loads the chat's saved checkpoints once, before anything reads or adds to them. */
export function ensureCheckpointsLoaded(chatId: string): Promise<void> {
  if (useAgentCheckpointsStore.getState().byChat[chatId]) return Promise.resolve();
  let load = loads.get(chatId);
  if (!load) {
    load = invoke<string | null>("load_chat_checkpoints", { chatId })
      .then((data) => parseChatCheckpoints(data))
      .catch(() => parseChatCheckpoints(null))
      .then((loaded) => {
        // A write recorded while the load was in flight is already in the store; keep it.
        if (useAgentCheckpointsStore.getState().byChat[chatId]) return;
        useAgentCheckpointsStore.getState().actions.setChatCheckpoints(chatId, loaded);
      })
      .finally(() => loads.delete(chatId));
    loads.set(chatId, load);
  }
  return load;
}

/**
 * Adds an agent write to the checkpoint of the turn `messageId` started. The write already
 * landed; this only remembers what the file held before the turn, so the turn can be undone.
 */
export function recordCheckpointAgentWrite(
  chatId: string,
  messageId: string,
  write: CheckpointWrite,
): Promise<void> {
  return enqueue(chatId, async () => {
    await ensureCheckpointsLoaded(chatId);
    setCheckpoints(
      chatId,
      recordCheckpointWrite(getChatCheckpoints(chatId), messageId, write, Date.now()),
    );
  });
}

/** The chat's turns that changed files, oldest first. */
export async function listCheckpoints(chatId: string): Promise<AgentCheckpointSummary[]> {
  await ensureCheckpointsLoaded(chatId);
  return summarizeCheckpoints(getChatCheckpoints(chatId));
}

/**
 * What restoring the chat to before `messageId` would change, given the chat's `messages` for
 * turn order. Null while nothing at or after that message changed a file; "unavailable" once the
 * checkpoints that turn needs were dropped to stay within the storage budget.
 */
export function planChatRestore(
  state: ChatCheckpoints,
  messageId: string,
  messages: readonly Message[],
): CheckpointRestorePlan | "unavailable" | null {
  const plan = planCheckpointRestore(
    state,
    messageId,
    messages.map((message) => message.id),
  );
  if (!plan) return null;
  const message = messages.find((item) => item.id === messageId);
  const timestamp = message ? message.timestamp.getTime() : null;
  return isCheckpointAvailable(state, timestamp) ? plan : "unavailable";
}

async function readDisk(path: string): Promise<string | null> {
  try {
    return await readFileContent(path);
  } catch {
    return null;
  }
}

function findEditorBuffer(path: string) {
  const buffer = getBufferByPath(useBufferStore.getState().buffers, path);
  return buffer?.type === "editor" ? buffer : null;
}

/**
 * Brings the agent edits log up to date with a restored file. This chat's review of the undone
 * turns goes away with them; review of earlier turns stays, now measured against the restored
 * text. Other chats keep what they can, like after any change outside their agent.
 */
function syncAgentEdits(chatId: string, path: string, content: string | null, undone: Set<string>) {
  const { byChat, actions } = useAgentEditsStore.getState();
  for (const [otherChatId, entries] of Object.entries(byChat)) {
    const entry = entries[path];
    if (!entry || entry.current === content) continue;
    if (otherChatId === chatId) {
      const fromUndoneTurn = !entry.turnId || undone.has(entry.turnId);
      const next =
        content === null || fromUndoneTurn || entry.baseline === content
          ? null
          : { ...entry, current: content, revision: entry.revision + 1 };
      actions.setEntry(chatId, path, next);
      continue;
    }
    const rebased = content === null ? null : rebaseOnDisk(entry, content);
    actions.setEntry(
      otherChatId,
      path,
      rebased && rebased.baseline !== rebased.current ? rebased : null,
    );
    if (!rebased) {
      showToast({
        key: `agent-edits-dropped:${path}`,
        type: "warning",
        message: `Stopped tracking agent changes to ${getBaseName(path)}`,
        description: "Another chat restored a checkpoint over the lines this chat's agent edited.",
      });
    }
  }
}

async function restoreFile(path: string, target: string | null, disk: string | null) {
  const buffer = findEditorBuffer(path);
  const { markPendingSave } = useFileWatcherStore.getState().actions;
  if (target === null) {
    if (buffer) useBufferStore.getState().actions.closeBufferForce(buffer.id);
    if (disk === null) return;
    markPendingSave(path);
    await deleteFileOrDirectory(path);
  } else {
    markPendingSave(path);
    await writeFile(path, target);
    if (buffer) useBufferStore.getState().actions.updateBufferContent(buffer.id, target, false);
  }
  emitGitChanged({ filePath: path, scopes: ["working-tree"], source: "agent-checkpoint" });
}

function describeFiles(paths: string[]): string {
  const names = paths.map((path) => getBaseName(path));
  return names.length > 3
    ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
    : names.join(", ");
}

/**
 * Puts every file the agent changed at or after `messageId` back the way it was before that
 * turn: files the agent created are deleted and files it deleted come back. When a file changed
 * since the agent last wrote it, or has unsaved edits, the user confirms discarding that first.
 * The undone turns' checkpoints are dropped afterwards.
 */
export function restoreCheckpoint(
  chatId: string,
  messageId: string,
): Promise<CheckpointRestoreResult> {
  return enqueue(chatId, async (): Promise<CheckpointRestoreResult> => {
    await ensureCheckpointsLoaded(chatId);
    const plan = planChatRestore(
      getChatCheckpoints(chatId),
      messageId,
      findChat(chatId)?.messages ?? [],
    );
    if (plan === "unavailable") return { status: "unavailable" };
    if (!plan) return { status: "nothing-to-restore" };

    const disks = new Map<string, string | null>();
    const changedSince: string[] = [];
    for (const file of plan.files) {
      const disk = await readDisk(file.path);
      disks.set(file.path, disk);
      const buffer = findEditorBuffer(file.path);
      const unsaved = buffer?.isDirty && buffer.content !== file.target;
      if (disk !== file.expected || unsaved) changedSince.push(file.path);
    }

    if (changedSince.length > 0) {
      const confirmed = await showConfirmDialog(
        `${describeFiles(changedSince)} changed after the agent edited ${
          changedSince.length === 1 ? "it" : "them"
        }. Restoring the checkpoint discards those changes, including unsaved edits.`,
        { title: "Restore checkpoint", confirmLabel: "Discard and restore" },
      );
      if (!confirmed) return { status: "cancelled" };
    }

    const undone = new Set(plan.messageIds);
    const restoredPaths: string[] = [];
    const failedPaths: string[] = [];
    for (const file of plan.files) {
      try {
        await restoreFile(file.path, file.target, disks.get(file.path) ?? null);
        syncAgentEdits(chatId, file.path, file.target, undone);
        restoredPaths.push(file.path);
      } catch (error) {
        console.error(`Could not restore ${file.path}:`, error);
        failedPaths.push(file.path);
      }
    }

    setCheckpoints(chatId, dropRestoredCheckpoints(getChatCheckpoints(chatId), plan.messageIds));
    if (failedPaths.length > 0) {
      showToast({
        type: "error",
        message: `Could not restore ${describeFiles(failedPaths)}`,
        description: "The other files were restored.",
      });
    }
    return { status: "restored", restoredPaths, failedPaths };
  });
}
