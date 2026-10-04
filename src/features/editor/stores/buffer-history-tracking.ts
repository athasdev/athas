import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { EditorUndoGroupTracker } from "@/features/editor/history/undo-group-tracker";
import type {
  EditorModelTextChange,
  EditorTextChange,
  Position,
  Range,
} from "@/features/editor/types/editor.types";
import { useHistoryStore } from "@/features/editor/stores/history.store";

const trackers = new WeakMap<ReturnType<typeof useHistoryStore.getStore>, EditorUndoGroupTracker>();
function getHistoryOwner(workspaceId?: string) {
  const store = useHistoryStore.getStore(
    workspaceId ?? workspaceRuntimeRegistry.getActiveWorkspaceId(),
  );
  let tracker = trackers.get(store);
  if (!tracker) {
    tracker = new EditorUndoGroupTracker();
    trackers.set(store, tracker);
  }
  return { store, tracker };
}

export function cleanupBufferHistoryTracking(bufferId: string, workspaceId?: string): void {
  getHistoryOwner(workspaceId).tracker.cleanup(bufferId);
}

export function hasPendingBufferHistory(bufferId: string, workspaceId?: string): boolean {
  return getHistoryOwner(workspaceId).tracker.hasPendingChange(bufferId);
}

export function flushPendingBufferHistory(
  bufferId: string,
  currentContent: string,
  workspaceId?: string,
): void {
  const { store, tracker } = getHistoryOwner(workspaceId);
  const entry = tracker.flush(bufferId, currentContent);
  if (entry) store.getState().actions.pushHistory(bufferId, entry);
}

export function syncBufferHistoryContent(
  bufferId: string,
  content: string,
  workspaceId?: string,
): void {
  getHistoryOwner(workspaceId).tracker.sync(bufferId, content);
}

export function trackImmediateBufferHistoryChange({
  bufferId,
  currentContent,
  nextContent,
  previousCursorPosition,
  previousSelection,
  workspaceId,
}: {
  bufferId: string;
  currentContent: string;
  nextContent: string;
  previousCursorPosition?: Position;
  previousSelection?: Range;
  workspaceId?: string;
}): void {
  const { store, tracker } = getHistoryOwner(workspaceId);
  if (currentContent === nextContent) {
    tracker.sync(bufferId, nextContent);
    return;
  }

  flushPendingBufferHistory(bufferId, currentContent, workspaceId);
  store.getState().actions.pushHistory(bufferId, {
    content: currentContent,
    cursorPosition: previousCursorPosition ? { ...previousCursorPosition } : undefined,
    selection: previousSelection
      ? {
          start: { ...previousSelection.start },
          end: { ...previousSelection.end },
        }
      : undefined,
    timestamp: Date.now(),
  });
  tracker.sync(bufferId, nextContent);
}

export function trackBufferHistoryChange({
  bufferId,
  currentContent,
  nextContent,
  previousContent,
  previousCursorPosition,
  previousSelection,
  skipUndoGrouping,
  contentChange,
  contentChanges,
  workspaceId,
}: {
  bufferId: string;
  currentContent: string;
  nextContent: string;
  previousContent?: string;
  previousCursorPosition?: Position;
  previousSelection?: Range;
  skipUndoGrouping?: boolean;
  contentChange?: EditorTextChange;
  contentChanges?: readonly EditorModelTextChange[];
  workspaceId?: string;
}): void {
  const { store, tracker } = getHistoryOwner(workspaceId);
  if (skipUndoGrouping) {
    trackImmediateBufferHistoryChange({
      bufferId,
      currentContent: previousContent ?? currentContent,
      nextContent,
      previousCursorPosition,
      previousSelection,
      workspaceId,
    });
    return;
  }

  const lastTrackedContent = tracker.getTrackedContent(bufferId);
  const contentBeforeChange = contentChanges?.length
    ? (previousContent ?? currentContent)
    : (lastTrackedContent ?? previousContent ?? currentContent);
  if (contentBeforeChange !== nextContent) store.getState().actions.discardFuture(bufferId);

  if (!contentChanges?.length && lastTrackedContent === undefined) {
    tracker.sync(bufferId, contentBeforeChange);
  }

  const historyEntries = contentChanges?.length
    ? tracker.trackChanges(bufferId, contentBeforeChange, nextContent, contentChanges, {
        previousCursorPosition,
        previousSelection,
      })
    : tracker.track(bufferId, contentBeforeChange, nextContent, {
        previousCursorPosition,
        previousSelection,
        contentChange,
      });
  const { pushHistory } = store.getState().actions;
  for (const entry of historyEntries) {
    pushHistory(bufferId, entry);
  }
}
