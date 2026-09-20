import {
  getUndoEditDelta,
  getUndoEditDeltaFromChange,
  shouldStartNewUndoGroupForDelta,
  type UndoEditDelta,
  type UndoEditOperation,
} from "./undo-grouping";
import type { HistoryEntry, PatchHistoryEntry, StoredHistoryEntry } from "../types/history.types";
import type {
  EditorModelTextChange,
  EditorTextChange,
  Position,
  Range,
} from "../types/editor.types";
import { createHistoryPatchBatch } from "./history-patches";

interface PendingUndoGroup {
  baseEntry: HistoryEntry;
  latestContent: string;
  operation: UndoEditOperation;
  lastEditDelta: UndoEditDelta;
}

interface PendingPatchUndoGroup {
  entry: PatchHistoryEntry;
  operation: UndoEditOperation;
  lastEditDelta: UndoEditDelta;
}

export interface UndoTrackOptions {
  previousCursorPosition?: Position;
  previousSelection?: Range;
  contentChange?: EditorTextChange;
}

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

export class EditorUndoGroupTracker {
  private readonly lastBufferContent = new Map<string, string>();
  private readonly pendingUndoGroups = new Map<string, PendingUndoGroup>();
  private readonly pendingPatchUndoGroups = new Map<string, PendingPatchUndoGroup>();

  cleanup(bufferId: string): void {
    this.pendingUndoGroups.delete(bufferId);
    this.pendingPatchUndoGroups.delete(bufferId);
    this.lastBufferContent.delete(bufferId);
  }

  sync(bufferId: string, content: string): void {
    this.pendingUndoGroups.delete(bufferId);
    this.pendingPatchUndoGroups.delete(bufferId);
    this.lastBufferContent.set(bufferId, content);
  }

  track(
    bufferId: string,
    previousContent: string,
    nextContent: string,
    options: UndoTrackOptions = {},
  ): StoredHistoryEntry[] {
    if (previousContent === nextContent) {
      this.lastBufferContent.set(bufferId, nextContent);
      return [];
    }

    const entries: StoredHistoryEntry[] = [];
    const pendingPatchGroup = this.pendingPatchUndoGroups.get(bufferId);
    if (pendingPatchGroup) {
      entries.push(pendingPatchGroup.entry);
      this.pendingPatchUndoGroups.delete(bufferId);
    }
    const pendingGroup = this.pendingUndoGroups.get(bufferId);
    const previousOperation = pendingGroup?.operation ?? "other";
    const delta = options.contentChange
      ? getUndoEditDeltaFromChange(previousContent, options.contentChange, previousOperation)
      : getUndoEditDelta(previousContent, nextContent, previousOperation);
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
      const closedEntry = this.entryForGroup(pendingGroup);
      if (closedEntry) entries.push(closedEntry);
      this.pendingUndoGroups.set(bufferId, {
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
      this.pendingUndoGroups.set(bufferId, {
        baseEntry,
        latestContent: nextContent,
        operation,
        lastEditDelta: delta,
      });
    }

    this.lastBufferContent.set(bufferId, nextContent);
    return entries;
  }

  trackChanges(
    bufferId: string,
    previousContent: string,
    nextContent: string,
    changes: readonly EditorModelTextChange[],
    options: Omit<UndoTrackOptions, "contentChange"> = {},
  ): StoredHistoryEntry[] {
    if (changes.length === 0 || previousContent === nextContent) return [];
    const patch = createHistoryPatchBatch(previousContent, changes);
    if (!patch || patch.afterLength !== nextContent.length) {
      return this.track(bufferId, previousContent, nextContent, options);
    }

    const entries: StoredHistoryEntry[] = [];
    const pendingSnapshotGroup = this.pendingUndoGroups.get(bufferId);
    if (pendingSnapshotGroup) {
      const snapshotEntry = this.entryForGroup(pendingSnapshotGroup);
      if (snapshotEntry) entries.push(snapshotEntry);
      this.pendingUndoGroups.delete(bufferId);
    }
    this.lastBufferContent.delete(bufferId);
    const pendingGroup = this.pendingPatchUndoGroups.get(bufferId);
    const previousOperation = pendingGroup?.operation ?? "other";
    const delta =
      changes.length === 1
        ? getUndoEditDeltaFromChange(previousContent, changes[0], previousOperation)
        : {
            operation: "other" as const,
            startOffset: Math.min(...changes.map((change) => change.rangeOffset)),
            endOffset: Math.max(
              ...changes.map((change) => change.rangeOffset + change.text.length),
            ),
            insertedText: "",
            removedText: "",
            insertedLength: changes.reduce((total, change) => total + change.text.length, 0),
            removedLength: changes.reduce((total, change) => total + change.rangeLength, 0),
          };
    const operation = delta.operation;
    const entry: PatchHistoryEntry = {
      kind: "patch",
      patches: [patch],
      beforeLength: patch.beforeLength,
      afterLength: patch.afterLength,
      cursorPosition: clonePosition(options.previousCursorPosition),
      selection: cloneRange(options.previousSelection),
      timestamp: Date.now(),
    };

    if (
      pendingGroup &&
      shouldStartNewUndoGroupForDelta(pendingGroup.operation, pendingGroup.lastEditDelta, delta)
    ) {
      entries.push(pendingGroup.entry);
      this.pendingPatchUndoGroups.set(bufferId, { entry, operation, lastEditDelta: delta });
    } else if (pendingGroup) {
      pendingGroup.entry.patches.push(patch);
      pendingGroup.entry.afterLength = patch.afterLength;
      pendingGroup.operation = operation;
      pendingGroup.lastEditDelta = delta;
    } else {
      this.pendingPatchUndoGroups.set(bufferId, { entry, operation, lastEditDelta: delta });
    }

    return entries;
  }

  getTrackedContent(bufferId: string): string | undefined {
    return this.lastBufferContent.get(bufferId);
  }

  flush(bufferId: string, currentContent: string): StoredHistoryEntry | null {
    const pendingPatchGroup = this.pendingPatchUndoGroups.get(bufferId);
    this.pendingPatchUndoGroups.delete(bufferId);
    if (pendingPatchGroup) {
      return pendingPatchGroup.entry.afterLength === currentContent.length
        ? pendingPatchGroup.entry
        : null;
    }
    const pendingGroup = this.pendingUndoGroups.get(bufferId);
    this.pendingUndoGroups.delete(bufferId);
    this.lastBufferContent.set(bufferId, currentContent);

    if (!pendingGroup) return null;
    return this.entryForGroup(pendingGroup, currentContent);
  }

  private entryForGroup(
    group: PendingUndoGroup,
    currentContent = group.latestContent,
  ): HistoryEntry | null {
    return group.baseEntry.content === currentContent ? null : group.baseEntry;
  }
}
