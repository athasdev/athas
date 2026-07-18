import { EditorUndoGroupTracker } from "@/features/editor/history/undo-group-tracker";
import type { Position, Range } from "@/features/editor/types/editor.types";
import { useHistoryStore } from "@/features/editor/stores/history.store";

const undoGroupTracker = new EditorUndoGroupTracker();

export function cleanupBufferHistoryTracking(bufferId: string): void {
  undoGroupTracker.cleanup(bufferId);
}

export function flushPendingBufferHistory(bufferId: string, currentContent: string): void {
  const entry = undoGroupTracker.flush(bufferId, currentContent);
  if (entry) useHistoryStore.getState().actions.pushHistory(bufferId, entry);
}

export function syncBufferHistoryContent(bufferId: string, content: string): void {
  undoGroupTracker.sync(bufferId, content);
}

export function trackImmediateBufferHistoryChange({
  bufferId,
  currentContent,
  nextContent,
  previousCursorPosition,
  previousSelection,
}: {
  bufferId: string;
  currentContent: string;
  nextContent: string;
  previousCursorPosition?: Position;
  previousSelection?: Range;
}): void {
  if (currentContent === nextContent) {
    undoGroupTracker.sync(bufferId, nextContent);
    return;
  }

  flushPendingBufferHistory(bufferId, currentContent);
  useHistoryStore.getState().actions.pushHistory(bufferId, {
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
  undoGroupTracker.sync(bufferId, nextContent);
}

export function trackBufferHistoryChange({
  bufferId,
  currentContent,
  nextContent,
  previousContent,
  previousCursorPosition,
  previousSelection,
  skipUndoGrouping,
}: {
  bufferId: string;
  currentContent: string;
  nextContent: string;
  previousContent?: string;
  previousCursorPosition?: Position;
  previousSelection?: Range;
  skipUndoGrouping?: boolean;
}): void {
  if (skipUndoGrouping) {
    trackImmediateBufferHistoryChange({
      bufferId,
      currentContent: previousContent ?? currentContent,
      nextContent,
      previousCursorPosition,
      previousSelection,
    });
    return;
  }

  const lastTrackedContent = undoGroupTracker.getTrackedContent(bufferId);
  const contentBeforeChange = lastTrackedContent ?? previousContent ?? currentContent;

  if (lastTrackedContent === undefined) {
    undoGroupTracker.sync(bufferId, contentBeforeChange);
  }

  const historyEntries = undoGroupTracker.track(bufferId, contentBeforeChange, nextContent, {
    previousCursorPosition,
    previousSelection,
  });
  const { pushHistory } = useHistoryStore.getState().actions;
  for (const entry of historyEntries) {
    pushHistory(bufferId, entry);
  }
}
