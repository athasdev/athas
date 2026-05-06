import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { gitDiffCache } from "@/features/git/utils/git-diff-cache";
import { recordLocalHistoryFile } from "@/features/local-history/api/local-history-api";
import { isEditorContent } from "@/features/panes/types/pane-content";
import { createSelectors } from "@/utils/zustand-selectors";
import { writeFile } from "@/features/file-system/controllers/platform";
import {
  getUndoEditDelta,
  shouldStartNewUndoGroupForDelta,
  type UndoEditDelta,
  type UndoEditOperation,
} from "../history/undo-grouping";
import type { HistoryEntry } from "../history/types";
import type { Position, Range } from "../types/editor";
import { useHistoryStore } from "./history-store";

const lastBufferContent = new Map<string, string>();

interface PendingUndoGroup {
  baseEntry: HistoryEntry;
  latestContent: string;
  operation: UndoEditOperation;
  lastEditDelta: UndoEditDelta;
}

const pendingUndoGroups = new Map<string, PendingUndoGroup>();

function clonePosition(position?: Position): Position | undefined {
  return position ? { ...position } : undefined;
}

function cloneRange(range?: Range): Range | undefined {
  return range
    ? {
        start: { ...range.start },
        end: { ...range.end },
      }
    : undefined;
}

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

export function cleanupBufferHistoryTracking(bufferId: string): void {
  pendingUndoGroups.delete(bufferId);
  lastBufferContent.delete(bufferId);
}

export function flushPendingBufferHistory(bufferId: string, currentContent: string): void {
  const pendingGroup = pendingUndoGroups.get(bufferId);
  if (pendingGroup && pendingGroup.baseEntry.content !== currentContent) {
    useHistoryStore.getState().actions.pushHistory(bufferId, pendingGroup.baseEntry);
  }

  pendingUndoGroups.delete(bufferId);
  lastBufferContent.set(bufferId, currentContent);
}

export function syncBufferHistoryContent(bufferId: string, content: string): void {
  pendingUndoGroups.delete(bufferId);
  lastBufferContent.set(bufferId, content);
}

function pushPendingUndoGroup(bufferId: string, group: PendingUndoGroup): void {
  if (group.baseEntry.content === group.latestContent) return;

  useHistoryStore.getState().actions.pushHistory(bufferId, group.baseEntry);
}

interface TrackPendingUndoGroupOptions {
  previousCursorPosition?: Position;
  previousSelection?: Range;
}

function trackPendingUndoGroup(
  bufferId: string,
  previousContent: string,
  nextContent: string,
  options: TrackPendingUndoGroupOptions = {},
): void {
  if (previousContent === nextContent) {
    lastBufferContent.set(bufferId, nextContent);
    return;
  }

  const pendingGroup = pendingUndoGroups.get(bufferId);
  const previousOperation = pendingGroup?.operation ?? "other";
  const delta = getUndoEditDelta(previousContent, nextContent, previousOperation);
  const operation = delta.operation;
  const baseEntry: HistoryEntry = {
    content: previousContent,
    cursorPosition: clonePosition(options.previousCursorPosition),
    selection: cloneRange(options.previousSelection),
    timestamp: Date.now(),
  };

  if (
    pendingGroup &&
    shouldStartNewUndoGroupForDelta(pendingGroup.operation, pendingGroup.lastEditDelta, delta)
  ) {
    pushPendingUndoGroup(bufferId, pendingGroup);
    pendingUndoGroups.set(bufferId, {
      baseEntry,
      latestContent: nextContent,
      operation,
      lastEditDelta: delta,
    });
  } else if (pendingGroup) {
    pendingGroup.latestContent = nextContent;
    pendingGroup.operation = operation;
    pendingGroup.lastEditDelta = delta;
  } else {
    pendingUndoGroups.set(bufferId, {
      baseEntry,
      latestContent: nextContent,
      operation,
      lastEditDelta: delta,
    });
  }

  lastBufferContent.set(bufferId, nextContent);
}

interface AppState {
  autoSaveTimeoutId: NodeJS.Timeout | null;
  quickEditState: {
    isOpen: boolean;
    selectedText: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  };
  actions: AppActions;
}

interface AppActions {
  handleContentChange: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => Promise<void>;
  handleSave: () => Promise<void>;
  openQuickEdit: (params: {
    text: string;
    cursorPosition: { x: number; y: number };
    selectionRange: { start: number; end: number };
  }) => void;
  cleanup: () => void;
}

export const useEditorAppStore = createSelectors(
  create<AppState>()(
    immer((set, get) => ({
      autoSaveTimeoutId: null,
      quickEditState: {
        isOpen: false,
        selectedText: "",
        cursorPosition: { x: 0, y: 0 },
        selectionRange: { start: 0, end: 0 },
      },
      actions: {
        handleContentChange: async (
          content: string,
          previousContent?: string,
          previousCursorPosition?: Position,
          previousSelection?: Range,
        ) => {
          const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
          const { useFileWatcherStore } =
            await import("@/features/file-system/controllers/file-watcher-store");
          const { useSettingsStore } = await import("@/features/settings/store");
          const { activeBufferId, buffers } = useBufferStore.getState();
          const { updateBufferContent, markBufferDirty } = useBufferStore.getState().actions;
          const { settings } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;

          if (activeBufferId) {
            const lastTrackedContent = lastBufferContent.get(activeBufferId);
            const contentBeforeChange =
              lastTrackedContent ?? previousContent ?? activeBuffer.content;

            if (lastTrackedContent === undefined) {
              lastBufferContent.set(activeBufferId, contentBeforeChange);
            }

            trackPendingUndoGroup(activeBufferId, contentBeforeChange, content, {
              previousCursorPosition,
              previousSelection,
            });
          }

          const isRemoteFile = activeBuffer.path.startsWith("remote://");

          if (isRemoteFile) {
            updateBufferContent(activeBuffer.id, content, false);
          } else {
            updateBufferContent(activeBuffer.id, content, true);

            if (!activeBuffer.isVirtual && settings.autoSave) {
              const { autoSaveTimeoutId } = get();
              if (autoSaveTimeoutId) {
                clearTimeout(autoSaveTimeoutId);
              }

              const newTimeoutId = setTimeout(async () => {
                try {
                  markPendingSave(activeBuffer.path);
                  await recordLocalHistoryBeforeWrite(activeBuffer.path, "auto-save");
                  await writeFile(activeBuffer.path, content);
                  markBufferDirty(activeBuffer.id, false);

                  const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
                  if (rootFolderPath) {
                    gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
                    setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent("git-status-updated", {
                          detail: { filePath: activeBuffer.path },
                        }),
                      );
                    }, 50);
                  }
                } catch (error) {
                  console.error("Error saving file:", error);
                  markBufferDirty(activeBuffer.id, true);
                }
              }, 150);

              set((state) => {
                state.autoSaveTimeoutId = newTimeoutId;
              });
            }
          }
        },

        handleSave: async () => {
          const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
          const { useSettingsStore } = await import("@/features/settings/store");
          const { useFileWatcherStore } =
            await import("@/features/file-system/controllers/file-watcher-store");

          const { activeBufferId, buffers } = useBufferStore.getState();
          const { markBufferDirty } = useBufferStore.getState().actions;
          const { updateSettingsFromJSON } = useSettingsStore.getState();
          const { markPendingSave } = useFileWatcherStore.getState();

          const activeBuffer = buffers.find((b) => b.id === activeBufferId);
          if (!activeBuffer || !isEditorContent(activeBuffer)) return;

          if (activeBuffer.path.startsWith("untitled:")) {
            const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
            const result = await saveDialog({
              title: "Save",
              defaultPath: activeBuffer.name,
              filters: [{ name: "All Files", extensions: ["*"] }],
            });
            if (result) {
              await writeFile(result, activeBuffer.content);
              useBufferStore.getState().actions.updateBufferPath(activeBuffer.id, result);
              markBufferDirty(activeBuffer.id, false);
            }
            return;
          }

          if (activeBuffer.isVirtual) {
            if (activeBuffer.path === "settings://user-settings.json") {
              const success = updateSettingsFromJSON(activeBuffer.content);
              markBufferDirty(activeBuffer.id, !success);
            } else {
              markBufferDirty(activeBuffer.id, false);
            }
          } else if (activeBuffer.path.startsWith("remote://")) {
            markBufferDirty(activeBuffer.id, true);
            const pathParts = activeBuffer.path.replace("remote://", "").split("/");
            const connectionId = pathParts.shift();
            const remotePath = `/${pathParts.join("/")}`;

            if (connectionId) {
              try {
                await invoke("ssh_write_file", {
                  connectionId,
                  filePath: remotePath,
                  content: activeBuffer.content,
                });
                markBufferDirty(activeBuffer.id, false);
              } catch (error) {
                console.error("Error saving remote file:", error);
                markBufferDirty(activeBuffer.id, true);
              }
            }
          } else {
            try {
              markPendingSave(activeBuffer.path);

              let contentToSave = activeBuffer.content;
              const { settings } = useSettingsStore.getState();

              if (settings.formatOnSave) {
                const { formatContent } =
                  await import("@/features/editor/formatter/formatter-service");
                const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

                const formatResult = await formatContent({
                  filePath: activeBuffer.path,
                  content: activeBuffer.content,
                  languageId: languageId || undefined,
                });

                if (formatResult.success && formatResult.formattedContent) {
                  contentToSave = formatResult.formattedContent;
                  const { updateBufferContent } = useBufferStore.getState().actions;
                  updateBufferContent(activeBufferId!, contentToSave, false);
                }
              }

              await recordLocalHistoryBeforeWrite(activeBuffer.path, "save");
              await writeFile(activeBuffer.path, contentToSave);
              markBufferDirty(activeBuffer.id, false);

              if (settings.lintOnSave) {
                const { lintContent } = await import("@/features/editor/linter/linter-service");
                const { convertLintDiagnostic, useDiagnosticsStore } =
                  await import("@/features/diagnostics/stores/diagnostics-store");
                const languageId = extensionRegistry.getLanguageId(activeBuffer.path);

                const lintResult = await lintContent({
                  filePath: activeBuffer.path,
                  content: contentToSave,
                  languageId: languageId || undefined,
                });

                if (lintResult.success && lintResult.diagnostics) {
                  useDiagnosticsStore.getState().actions.setDiagnostics(
                    activeBuffer.path,
                    lintResult.diagnostics.map((diagnostic) =>
                      convertLintDiagnostic(activeBuffer.path, diagnostic),
                    ),
                  );
                }
              }

              const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
              if (rootFolderPath) {
                gitDiffCache.invalidate(rootFolderPath, activeBuffer.path);
                setTimeout(() => {
                  window.dispatchEvent(
                    new CustomEvent("git-status-updated", {
                      detail: { filePath: activeBuffer.path },
                    }),
                  );
                }, 50);
              }
            } catch (error) {
              console.error("Error saving local file:", error);
              markBufferDirty(activeBuffer.id, true);
            }
          }
        },

        openQuickEdit: (params) => {
          set((state) => {
            state.quickEditState = {
              isOpen: true,
              selectedText: params.text,
              cursorPosition: params.cursorPosition,
              selectionRange: params.selectionRange,
            };
          });
        },

        cleanup: () => {
          const { autoSaveTimeoutId } = get();
          if (autoSaveTimeoutId) {
            clearTimeout(autoSaveTimeoutId);
          }
        },
      },
    })),
  ),
);
