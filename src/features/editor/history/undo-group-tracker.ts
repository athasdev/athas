import {
  getUndoEditDelta,
  shouldStartNewUndoGroupForDelta,
  type UndoEditDelta,
  type UndoEditOperation,
} from "./undo-grouping";
import type { HistoryEntry } from "./types";
import type { Position, Range } from "../types/editor";

interface PendingUndoGroup {
  baseEntry: HistoryEntry;
  latestContent: string;
  operation: UndoEditOperation;
  lastEditDelta: UndoEditDelta;
}

export interface UndoTrackOptions {
  previousCursorPosition?: Position;
  previousSelection?: Range;
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

  cleanup(bufferId: string): void {
    this.pendingUndoGroups.delete(bufferId);
    this.lastBufferContent.delete(bufferId);
  }

  sync(bufferId: string, content: string): void {
    this.pendingUndoGroups.delete(bufferId);
    this.lastBufferContent.set(bufferId, content);
  }

  track(
    bufferId: string,
    previousContent: string,
    nextContent: string,
    options: UndoTrackOptions = {},
  ): HistoryEntry[] {
    if (previousContent === nextContent) {
      this.lastBufferContent.set(bufferId, nextContent);
      return [];
    }

    const entries: HistoryEntry[] = [];
    const pendingGroup = this.pendingUndoGroups.get(bufferId);
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

  getTrackedContent(bufferId: string): string | undefined {
    return this.lastBufferContent.get(bufferId);
  }

  flush(bufferId: string, currentContent: string): HistoryEntry | null {
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
