import {
  captureBufferStoreOwner,
  isBufferStoreOwnerLive,
  type BufferStoreOwner,
} from "./buffer-store-owner";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { parseCollaborationNoteBufferPath } from "@/features/collaboration/lib/collaboration-sidebar-model";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { showToast } from "@/utils/toast";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { recordLocalHistoryFile } from "@/features/local-history/api/local-history-api";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { writeFile } from "@/features/file-system/controllers/platform";
import { getBufferById } from "../stores/buffer-index";
import { readBufferRevision, readBufferText } from "./buffer-text";
import { useProjectStore } from "@/features/workspace/stores/project.store";

/** Typing pauses this long before an auto-save writes the file. */
export const AUTO_SAVE_DELAY_MS = 1000;

async function recordLocalHistoryBeforeWrite(
  path: string,
  reason: "save" | "auto-save" | "restore",
): Promise<void> {
  try {
    await recordLocalHistoryFile(path, reason);
  } catch (error) {
    console.warn("Failed to record local history:", error);
  }
}

const editorSaveTasks = new WeakMap<BufferStoreOwner["store"], Map<string, Promise<boolean>>>();
const autoSaveTimers = new Map<
  BufferStoreOwner["store"],
  Map<string, ReturnType<typeof setTimeout>>
>();

function queueEditorSave(owner: BufferStoreOwner, bufferId: string, task: () => Promise<boolean>) {
  let tasks = editorSaveTasks.get(owner.store);
  if (!tasks) {
    tasks = new Map();
    editorSaveTasks.set(owner.store, tasks);
  }
  const pending = tasks;
  const previous = pending.get(bufferId) ?? Promise.resolve(false);
  const next = previous
    .catch(() => false)
    .then(() => (isBufferStoreOwnerLive(owner) ? task() : false))
    .catch((error) => {
      showToast({ message: `Could not save the file: ${String(error)}`, type: "error" });
      return false;
    });
  pending.set(bufferId, next);
  void next
    .finally(() => {
      if (pending.get(bufferId) === next) pending.delete(bufferId);
    })
    .catch(() => undefined);
  return next;
}

export function saveEditorBufferById(
  owner: BufferStoreOwner,
  bufferId: string,
  reason: "save" | "auto-save" = "save",
) {
  return queueEditorSave(owner, bufferId, () => performEditorSave(owner, bufferId, reason));
}

export function saveEditorBufferAsById(owner: BufferStoreOwner, bufferId: string) {
  return queueEditorSave(owner, bufferId, () => performEditorSaveAs(owner, bufferId));
}

async function performEditorSaveAs(owner: BufferStoreOwner, bufferId: string): Promise<boolean> {
  const original = getBufferById(owner.store.getState().buffers, bufferId);
  if (!original || !isEditorContent(original) || original.readOnly) return false;
  const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
  const result = await saveDialog({
    title: original.path.startsWith("untitled:") ? "Save" : "Save As",
    defaultPath: original.name,
    filters: [
      { name: "All Files", extensions: ["*"] },
      {
        name: "Text Files",
        extensions: ["txt", "md", "json", "js", "ts", "tsx", "jsx", "css", "html"],
      },
    ],
  });
  if (!result || !isBufferStoreOwnerLive(owner)) return false;
  const { buffers, actions } = owner.store.getState();
  const current = getBufferById(buffers, bufferId);
  if (!current || !isEditorContent(current) || current.readOnly || current.path !== original.path)
    return false;
  if (
    buffers.some(
      (buffer) => buffer.id !== bufferId && isEditorContent(buffer) && buffer.path === result,
    )
  ) {
    showToast({
      message: "The destination is already open in another tab. Close that tab before saving here.",
      type: "error",
    });
    return false;
  }
  const content = readBufferText(current);
  const contentRevision = readBufferRevision(current);
  const findDestination = () =>
    owner.store
      .getState()
      .buffers.find(
        (buffer) => buffer.id !== bufferId && isEditorContent(buffer) && buffer.path === result,
      );
  const { markPendingSave, clearPendingSave } = useFileWatcherStore
    .getStore(owner.workspaceId)
    .getState().actions;
  try {
    await recordLocalHistoryBeforeWrite(result, "save");
    const beforeWrite = getBufferById(owner.store.getState().buffers, bufferId);
    if (
      !isBufferStoreOwnerLive(owner) ||
      !beforeWrite ||
      !isEditorContent(beforeWrite) ||
      beforeWrite.readOnly ||
      beforeWrite.path !== original.path ||
      readBufferRevision(beforeWrite) !== contentRevision ||
      readBufferText(beforeWrite) !== content
    )
      return false;
    if (findDestination()) {
      showToast({
        message: "The destination was opened in another tab. Close that tab before saving here.",
        type: "error",
      });
      return false;
    }
    markPendingSave(result);
    if (result === current.path && !current.isVirtual) {
      await getWorkspaceResourceProvider(result).writeText(result, content, current.savedContent);
    } else {
      await writeFile(result, content);
    }
    emitGitChanged({ filePath: result, scopes: ["working-tree"], source: "save" });
    if (!isBufferStoreOwnerLive(owner)) return false;
    const destination = findDestination();
    if (destination && isEditorContent(destination)) {
      if (!destination.isVirtual) {
        if (!destination.isDirty && !destination.readOnly) {
          actions.updateBufferContent(destination.id, content, false);
        }
        actions.markBufferSaved(destination.id, content);
      }
      showToast({
        message:
          "The copy was saved, but its tab opened during the write. Your original remains unsaved and both drafts are preserved.",
        type: "info",
      });
      return false;
    }
    const latest = getBufferById(owner.store.getState().buffers, bufferId);
    if (
      isBufferStoreOwnerLive(owner) &&
      latest &&
      isEditorContent(latest) &&
      latest.path === original.path &&
      latest.savedContent === current.savedContent
    ) {
      actions.markBufferSaved(bufferId, content, result);
    }
    return true;
  } catch (error) {
    clearPendingSave(result);
    showToast({ message: `Could not save ${current.name}: ${String(error)}`, type: "error" });
    return false;
  }
}

export function scheduleEditorAutoSave(bufferId: string) {
  const owner = captureBufferStoreOwner();
  let timers = autoSaveTimers.get(owner.store);
  if (!timers) {
    timers = new Map();
    autoSaveTimers.set(owner.store, timers);
  }
  const pending = timers;
  const previous = pending.get(bufferId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    pending.delete(bufferId);
    if (pending.size === 0) autoSaveTimers.delete(owner.store);
    void saveEditorBufferById(owner, bufferId, "auto-save");
  }, AUTO_SAVE_DELAY_MS);
  pending.set(bufferId, timer);
}

export function cleanupEditorAutoSave() {
  for (const timers of autoSaveTimers.values()) {
    for (const timer of timers.values()) clearTimeout(timer);
  }
  autoSaveTimers.clear();
}

async function performEditorSave(
  owner: BufferStoreOwner,
  bufferId: string,
  reason: "save" | "auto-save",
): Promise<boolean> {
  const { buffers } = owner.store.getState();
  const { markBufferDirty, markBufferSaved, updateBufferContent } = owner.store.getState().actions;
  const { updateSettingsFromJSON } = useSettingsStore.getState().actions;
  const { markPendingSave, clearPendingSave } = useFileWatcherStore
    .getStore(owner.workspaceId)
    .getState().actions;
  const activeBuffer = getBufferById(buffers, bufferId);
  if (!activeBuffer || !isEditorContent(activeBuffer)) return false;
  if (activeBuffer.readOnly) return false;
  const rootFolderPath = useProjectStore.getStore(owner.workspaceId).getState().rootFolderPath;
  if (
    reason === "auto-save" &&
    (!useSettingsStore.getState().settings.autoSave ||
      activeBuffer.isVirtual ||
      activeBuffer.path.startsWith("untitled:") ||
      !activeBuffer.isDirty)
  )
    return false;

  const snapshotContent = readBufferText(activeBuffer);
  const snapshotRevision = readBufferRevision(activeBuffer);
  const matchesSnapshot = () => {
    const current = getBufferById(owner.store.getState().buffers, bufferId);
    return (
      isBufferStoreOwnerLive(owner) &&
      current &&
      isEditorContent(current) &&
      !current.readOnly &&
      current.path === activeBuffer.path &&
      current.savedContent === activeBuffer.savedContent &&
      readBufferRevision(current) === snapshotRevision &&
      readBufferText(current) === snapshotContent
    );
  };
  const acknowledgeSave = (content: string) => {
    const current = getBufferById(owner.store.getState().buffers, bufferId);
    if (
      isBufferStoreOwnerLive(owner) &&
      current &&
      isEditorContent(current) &&
      current.path === activeBuffer.path &&
      current.savedContent === activeBuffer.savedContent
    )
      markBufferSaved(bufferId, content);
  };

  const collaborationNoteTarget = parseCollaborationNoteBufferPath(activeBuffer.path);

  if (activeBuffer.path.startsWith("untitled:")) return performEditorSaveAs(owner, bufferId);

  if (collaborationNoteTarget) {
    const [{ updateCollaborationChannelNote }, { useAuthStore }, { updateCollaborationNoteFile }] =
      await Promise.all([
        import("@/features/collaboration/services/collaboration-api"),
        import("@/features/auth/stores/auth.store"),
        import("@/features/collaboration/lib/collaboration-sidebar-model"),
      ]);
    const { subscription, actions } = useAuthStore.getState();
    const collaboration = subscription?.collaboration;
    const channelNote = collaboration?.channelNotes.find(
      (note) => note.channelId === collaborationNoteTarget.channelId,
    );

    if (!channelNote) {
      markBufferDirty(activeBuffer.id, true);
      return false;
    }

    const nextCollaboration = await updateCollaborationChannelNote({
      channelId: collaborationNoteTarget.channelId,
      contentMarkdown: updateCollaborationNoteFile({
        contentMarkdown: channelNote.contentMarkdown,
        path: collaborationNoteTarget.notePath,
        fileContent: snapshotContent,
      }),
    });
    actions.setCollaborationSnapshot(nextCollaboration);
    acknowledgeSave(snapshotContent);
    return true;
  }

  if (activeBuffer.isVirtual) {
    if (activeBuffer.path === "settings://user-settings.json") {
      const success = updateSettingsFromJSON(snapshotContent);
      markBufferDirty(activeBuffer.id, !success);
      return success;
    }

    markBufferDirty(activeBuffer.id, false);
    return true;
  }

  const isRemoteFile = activeBuffer.path.startsWith("remote://");
  const { settings } = useSettingsStore.getState();
  let contentToSave = snapshotContent;
  try {
    if (reason === "save" && !isRemoteFile && settings.formatOnSave) {
      const { formatContent } = await import("@/features/editor/formatter/formatter-service");
      const languageId = extensionRegistry.getLanguageId(activeBuffer.path);
      const formatResult = await formatContent({
        filePath: activeBuffer.path,
        content: snapshotContent,
        languageId: languageId || undefined,
      });
      if (formatResult.success && formatResult.formattedContent !== undefined) {
        contentToSave = formatResult.formattedContent;
      }
    }
    if (!matchesSnapshot()) return false;
    if (!isRemoteFile) await recordLocalHistoryBeforeWrite(activeBuffer.path, reason);
    if (!matchesSnapshot()) return false;
    markPendingSave(activeBuffer.path);
    await getWorkspaceResourceProvider(activeBuffer.path).writeText(
      activeBuffer.path,
      contentToSave,
      activeBuffer.savedContent,
    );
  } catch (error) {
    clearPendingSave(activeBuffer.path);
    showToast({ message: `Could not save ${activeBuffer.name}: ${String(error)}`, type: "error" });
    return false;
  }

  if (matchesSnapshot() && contentToSave !== snapshotContent)
    updateBufferContent(bufferId, contentToSave, true);
  acknowledgeSave(contentToSave);
  if (rootFolderPath) {
    emitGitChanged({
      repoPath: rootFolderPath,
      filePath: activeBuffer.path,
      scopes: ["working-tree"],
      source: reason,
    });
  }
  if (!isRemoteFile && reason === "save") {
    try {
      const { LspClient } = await import("@/features/editor/lsp/lsp-client");
      await LspClient.getInstance().notifyDocumentSave(activeBuffer.path);
      if (settings.lintOnSave) {
        const { lintContent } = await import("@/features/editor/linter/linter-service");
        const { convertLintDiagnostic, useDiagnosticsStore } =
          await import("@/features/diagnostics/stores/diagnostics.store");
        const languageId = extensionRegistry.getLanguageId(activeBuffer.path);
        const lintResult = await lintContent({
          filePath: activeBuffer.path,
          content: contentToSave,
          languageId: languageId || undefined,
        });
        const current = getBufferById(owner.store.getState().buffers, bufferId);
        if (
          isBufferStoreOwnerLive(owner) &&
          current &&
          isEditorContent(current) &&
          current.path === activeBuffer.path &&
          readBufferText(current) === contentToSave &&
          lintResult.success &&
          lintResult.diagnostics
        ) {
          useDiagnosticsStore.getState().actions.setDiagnostics(
            activeBuffer.path,
            lintResult.diagnostics.map((diagnostic) =>
              convertLintDiagnostic(activeBuffer.path, diagnostic),
            ),
            "linter",
          );
        }
      }
    } catch (error) {
      console.warn("File saved, but post-save tooling failed:", error);
    }
  }
  return true;
}
