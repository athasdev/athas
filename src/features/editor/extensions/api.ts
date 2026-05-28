import { useBufferStore } from "../stores/buffer-store";
import { useEditorDecorationsStore } from "../stores/decorations-store";
import {
  flushPendingBufferHistory,
  syncBufferHistoryContent,
} from "../stores/buffer-history-tracking";
import { useHistoryStore } from "../stores/history-store";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorStateStore } from "../stores/state-store";
import { useEditorViewStore } from "../stores/view-store";
import type { HistoryEntry } from "../history/types";
import { isEditorContent } from "@/features/panes/types/pane-content";
import type { Decoration, Position, Range } from "../types/editor";
import {
  findBracketJumpTarget,
  findBracketSelectionRange,
  removeBracketPairAtCursor,
} from "../utils/bracket-matching";
import { toggleLineComment, getLineCommentTokenForLanguage } from "../utils/comment-toggle";
import { logger } from "../utils/logger";
import {
  calculateCursorPositionFromContent,
  calculateOffsetFromContentPosition,
} from "../utils/position";
import {
  resolveExpandSelection,
  resolveShrinkSelection,
  type OffsetRange,
} from "../utils/selection-ranges";
import {
  copyLineDown as copyLineDownOperation,
  copyLineUp as copyLineUpOperation,
  deleteLine as deleteLineOperation,
  duplicateLine as duplicateLineOperation,
  type LineOperationResult,
  moveLineDown as moveLineDownOperation,
  moveLineUp as moveLineUpOperation,
} from "../utils/line-operations";
import { resolveCursorPositionsAtLineEndsForSelection } from "../utils/multi-cursor";
import { getLineSlice } from "../utils/large-file";
import type {
  EditorAPI,
  EditorEvent,
  EditorEventPayload,
  EditorSettings,
  EventHandler,
} from "./types";
import { calculateLineHeight } from "../utils/lines";

interface ActiveEditorAdapter {
  ownerId: string;
  insertText: (text: string, position?: Position) => void;
  deleteRange: (range: Range) => void;
  replaceRange: (range: Range, text: string) => void;
  selectAll: () => void;
  undo: () => void;
  redo: () => void;
}

function normalizeSelectionOffsets(selection?: Range | null): OffsetRange | null {
  if (!selection || selection.start.offset === selection.end.offset) return null;
  return selection.start.offset < selection.end.offset
    ? { start: selection.start.offset, end: selection.end.offset }
    : { start: selection.end.offset, end: selection.start.offset };
}

function offsetRangesEqual(left: OffsetRange, right: OffsetRange): boolean {
  return left.start === right.start && left.end === right.end;
}

function containsOffsetRange(container: OffsetRange, candidate: OffsetRange): boolean {
  return container.start <= candidate.start && container.end >= candidate.end;
}

class EditorAPIImpl implements EditorAPI {
  private eventHandlers: Map<EditorEvent, Set<EventHandler<EditorEvent>>> = new Map();
  private cursorPosition: Position = { line: 0, column: 0, offset: 0 };
  private selection: Range | null = null;
  private textareaRef: HTMLTextAreaElement | null = null;
  private viewportRef: HTMLDivElement | null = null;
  private activeEditorAdapter: ActiveEditorAdapter | null = null;
  private smartSelectionHistory: OffsetRange[] = [];

  constructor() {
    // Initialize event handler sets
    const events: EditorEvent[] = [
      "contentChange",
      "selectionChange",
      "cursorChange",
      "settingsChange",
      "decorationChange",
      "keydown",
    ];

    events.forEach((event) => {
      this.eventHandlers.set(event, new Set());
    });
  }

  // Content operations
  getContent(): string {
    return useEditorViewStore.getState().actions.getContent();
  }

  setContent(content: string): void {
    const bufferStore = useBufferStore.getState();
    const activeBufferId = bufferStore.activeBufferId;
    if (activeBufferId) {
      bufferStore.actions.updateBufferContent(activeBufferId, content);
    }
    this.emit("contentChange", { content, changes: [] });
  }

  insertText(text: string, position?: Position): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.insertText(text, position);
      return;
    }

    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const textareaOwnsFullContent = this.textareaRef?.value === content;
    const pos =
      position ||
      (textareaOwnsFullContent && this.textareaRef
        ? calculateCursorPositionFromContent(this.textareaRef.selectionStart, content)
        : editorState.cursorPosition);
    const before = content.substring(0, pos.offset);
    const after = content.substring(pos.offset);
    const newContent = before + text + after;

    const newOffset = pos.offset + text.length;
    this.applyContentEdit(content, newContent, newOffset, newOffset, editorState);
  }

  deleteRange(range: Range): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.deleteRange(range);
      return;
    }

    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const before = content.substring(0, range.start.offset);
    const after = content.substring(range.end.offset);
    const newContent = before + after;

    const newOffset = range.start.offset;
    this.applyContentEdit(content, newContent, newOffset, newOffset, editorState);
  }

  replaceRange(range: Range, text: string): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.replaceRange(range, text);
      return;
    }

    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const before = content.substring(0, range.start.offset);
    const after = content.substring(range.end.offset);
    const newOffset = range.start.offset + text.length;

    this.applyContentEdit(content, before + text + after, newOffset, newOffset, editorState);
  }

  // Selection operations
  getSelection(): Range | null {
    return useEditorStateStore.getState().selection ?? null;
  }

  setSelection(range?: Range | null): void {
    this.selection = range ?? null;
    useEditorStateStore.getState().actions.setSelection(range ?? undefined);
    this.emit("selectionChange", range ?? null);
  }

  getCursorPosition(): Position {
    return useEditorStateStore.getState().cursorPosition;
  }

  setCursorPosition(position: Position): void {
    this.cursorPosition = position;
    this.emit("cursorChange", position);

    // Update cursor store to trigger UI updates
    useEditorStateStore.getState().actions.setCursorPosition(position);

    // Sync only when the textarea owns the full document. Large-file and folded
    // views use model state plus a small/virtual input surface.
    const textarea = this.getTextareaOwningContent(this.getContent());
    if (textarea) {
      textarea.selectionStart = textarea.selectionEnd = position.offset;
    }

    // Direct viewport scrolling for immediate response
    if (this.viewportRef) {
      const { fontSize, lineHeight: editorLineHeight } = this.getSettings();
      const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
      const targetLineTop = position.line * lineHeight;
      const targetLineBottom = targetLineTop + lineHeight;
      const currentScrollTop = this.viewportRef.scrollTop;
      const viewportHeight = this.viewportRef.clientHeight;

      // Scroll if cursor is out of view
      if (targetLineTop < currentScrollTop) {
        this.viewportRef.scrollTop = targetLineTop;
      } else if (targetLineBottom > currentScrollTop + viewportHeight) {
        this.viewportRef.scrollTop = targetLineBottom - viewportHeight;
      }
    }
  }

  selectAll(): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.selectAll();
      return;
    }

    const content = this.getContent();
    const textareaOwnsFullContent = this.textareaRef?.value === content;

    if (textareaOwnsFullContent && this.textareaRef) {
      this.textareaRef.select();
    }

    this.syncSelectionFromOffsets(content, 0, content.length);
  }

  // Internal method to update cursor and selection from external changes
  updateCursorAndSelection(cursor: Position, selection: Range | null): void {
    const cursorChanged =
      this.cursorPosition.line !== cursor.line ||
      this.cursorPosition.column !== cursor.column ||
      this.cursorPosition.offset !== cursor.offset;

    const selectionChanged =
      (this.selection === null && selection !== null) ||
      (this.selection !== null && selection === null) ||
      (this.selection !== null &&
        selection !== null &&
        (this.selection.start.offset !== selection.start.offset ||
          this.selection.end.offset !== selection.end.offset));

    if (cursorChanged) {
      this.cursorPosition = cursor;
      this.emit("cursorChange", cursor);
    }

    if (selectionChanged) {
      this.selection = selection;
      this.emit("selectionChange", selection);
    }
  }

  // Decoration operations
  addDecoration(decoration: Decoration): string {
    const id = useEditorDecorationsStore.getState().addDecoration(decoration);
    this.emit("decorationChange", { type: "add", decoration, id });
    return id;
  }

  removeDecoration(id: string): void {
    useEditorDecorationsStore.getState().removeDecoration(id);
    this.emit("decorationChange", { type: "remove", id });
  }

  updateDecoration(id: string, decoration: Partial<Decoration>): void {
    useEditorDecorationsStore.getState().updateDecoration(id, decoration);
    this.emit("decorationChange", { type: "update", id, decoration });
  }

  clearDecorations(): void {
    useEditorDecorationsStore.getState().clearDecorations();
    this.emit("decorationChange", { type: "clear" });
  }

  // Line operations
  getLines(): string[] {
    return useEditorViewStore.getState().actions.getLines();
  }

  getLine(lineNumber: number): string | undefined {
    const lineIndex = Math.trunc(lineNumber);
    if (!Number.isFinite(lineNumber) || lineIndex < 0) return undefined;

    const { lines, lineCount } = useEditorViewStore.getState();
    if (lineIndex >= lineCount) return undefined;

    const line = lines[lineIndex];
    if (line !== undefined) return line;

    return getLineSlice(this.getContent(), lineIndex).line;
  }

  getLineCount(): number {
    return useEditorViewStore.getState().lineCount;
  }

  duplicateLine(): void {
    this.applyLineOperation(duplicateLineOperation);
  }

  deleteLine(): void {
    this.applyLineOperation(deleteLineOperation);
  }

  toggleComment(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const textareaOwnsFullContent = this.textareaRef?.value === content;
    const selectionStart =
      textareaOwnsFullContent && this.textareaRef
        ? this.textareaRef.selectionStart
        : (editorState.selection?.start.offset ?? editorState.cursorPosition.offset);
    const selectionEnd =
      textareaOwnsFullContent && this.textareaRef
        ? this.textareaRef.selectionEnd
        : (editorState.selection?.end.offset ?? editorState.cursorPosition.offset);

    const result = toggleLineComment({
      content,
      selectionStart,
      selectionEnd,
      token: this.getActiveLineCommentToken(),
    });

    this.applyContentEdit(
      content,
      result.content,
      result.selectionStart,
      result.selectionEnd,
      editorState,
    );
  }

  goToMatchingBracket(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const target = findBracketJumpTarget(content, editorState.cursorPosition.offset);
    if (!target) return;

    this.setSelection(undefined);
    this.setCursorPosition(calculateCursorPositionFromContent(target.offset, content));
  }

  selectToBracket(selectBrackets = true): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const range = findBracketSelectionRange(content, editorState.cursorPosition.offset, {
      selectBrackets,
    });
    if (!range) return;

    const start = calculateCursorPositionFromContent(range.startOffset, content);
    const end = calculateCursorPositionFromContent(range.endOffset, content);
    this.setSelection({ start, end });
    this.setCursorPosition(end);
  }

  removeBrackets(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const result = removeBracketPairAtCursor(content, editorState.cursorPosition.offset);
    if (!result) return;

    this.applyContentEdit(
      content,
      result.content,
      result.cursorOffset,
      result.cursorOffset,
      editorState,
    );
  }

  expandSelection(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const currentRange = normalizeSelectionOffsets(editorState.selection);
    const target = resolveExpandSelection({
      content,
      cursorOffset: editorState.cursorPosition.offset,
      selectionStart: currentRange?.start,
      selectionEnd: currentRange?.end,
    });
    if (!target) return;

    if (currentRange && !offsetRangesEqual(currentRange, target)) {
      this.smartSelectionHistory.push(currentRange);
    }

    const start = calculateCursorPositionFromContent(target.start, content);
    const end = calculateCursorPositionFromContent(target.end, content);
    this.setSelection({ start, end });
    this.setCursorPosition(end);
  }

  shrinkSelection(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const currentRange = normalizeSelectionOffsets(editorState.selection);
    if (!currentRange) return;

    let target = this.smartSelectionHistory.pop() ?? null;
    while (
      target &&
      (!containsOffsetRange(currentRange, target) || offsetRangesEqual(currentRange, target))
    ) {
      target = this.smartSelectionHistory.pop() ?? null;
    }

    target ??= resolveShrinkSelection({
      content,
      cursorOffset: editorState.cursorPosition.offset,
      selectionStart: currentRange.start,
      selectionEnd: currentRange.end,
    });
    if (!target) return;

    const start = calculateCursorPositionFromContent(target.start, content);
    const end = calculateCursorPositionFromContent(target.end, content);
    this.setSelection({ start, end });
    this.setCursorPosition(end);
  }

  insertCursorAbove(): void {
    this.insertCursorVertical(-1);
  }

  insertCursorBelow(): void {
    this.insertCursorVertical(1);
  }

  insertCursorsAtLineEnds(): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const positions = resolveCursorPositionsAtLineEndsForSelection({
      content,
      selection: editorState.selection,
    });
    const firstPosition = positions[0];

    if (!firstPosition) return;

    const actions = useEditorStateStore.getState().actions;
    actions.disableMultiCursor();
    this.setSelection(undefined);
    this.setCursorPosition(firstPosition);
    actions.enableMultiCursor();

    for (const position of positions.slice(1)) {
      actions.addCursor(position);
    }

    if (this.textareaRef?.value === content) {
      this.textareaRef.focus();
      this.textareaRef.selectionStart = firstPosition.offset;
      this.textareaRef.selectionEnd = firstPosition.offset;
    }
  }

  moveLineUp(): void {
    this.applyLineOperation(moveLineUpOperation);
  }

  moveLineDown(): void {
    this.applyLineOperation(moveLineDownOperation);
  }

  copyLineUp(): void {
    this.applyLineOperation(copyLineUpOperation);
  }

  copyLineDown(): void {
    this.applyLineOperation(copyLineDownOperation);
  }

  private insertCursorVertical(direction: -1 | 1): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const targetLine = editorState.cursorPosition.line + direction;

    if (targetLine < 0 || targetLine >= this.getLineCount()) return;

    const targetLineText = this.getLine(targetLine) ?? "";
    const targetColumn = Math.min(editorState.cursorPosition.column, targetLineText.length);
    const position = {
      line: targetLine,
      column: targetColumn,
      offset: calculateOffsetFromContentPosition(content, targetLine, targetColumn),
    };
    const actions = useEditorStateStore.getState().actions;

    if (!useEditorStateStore.getState().multiCursorState) {
      actions.enableMultiCursor();
    }

    actions.addCursor(position);
    this.textareaRef?.focus();
  }

  // History operations
  private getCurrentHistoryEntry(content: string): HistoryEntry {
    const editorState = useEditorStateStore.getState();

    return {
      content,
      cursorPosition: editorState.cursorPosition,
      selection: editorState.selection,
      timestamp: Date.now(),
    };
  }

  undo(): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.undo();
      return;
    }

    const bufferStore = useBufferStore.getState();
    const activeBufferId = bufferStore.activeBufferId;

    if (!activeBufferId) {
      logger.warn("Editor", "No active buffer for undo");
      return;
    }

    const activeBuffer = bufferStore.buffers.find((buffer) => buffer.id === activeBufferId);
    if (!activeBuffer || !isEditorContent(activeBuffer)) return;
    const textareaOwningPreviousContent = this.getTextareaOwningContent(activeBuffer.content);

    flushPendingBufferHistory(activeBufferId, activeBuffer.content);

    const historyStore = useHistoryStore.getState();
    const entry = historyStore.actions.undo(
      activeBufferId,
      this.getCurrentHistoryEntry(activeBuffer.content),
    );

    if (entry) {
      // Restore content
      bufferStore.actions.updateBufferContent(activeBufferId, entry.content, false);
      syncBufferHistoryContent(activeBufferId, entry.content);

      if (textareaOwningPreviousContent) {
        textareaOwningPreviousContent.value = entry.content;
      }

      // Restore cursor position if available
      if (entry.cursorPosition) {
        this.setCursorPosition(entry.cursorPosition);
      } else if (textareaOwningPreviousContent) {
        textareaOwningPreviousContent.selectionStart =
          textareaOwningPreviousContent.selectionEnd = 0;
      }

      // Restore selection if it existed
      if (entry.selection) {
        this.setSelection(entry.selection);
      } else {
        this.setSelection(undefined);
      }

      // Emit content change event
      this.emitEvent("contentChange", { content: entry.content, changes: [] });
    }
  }

  redo(): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.redo();
      return;
    }

    const bufferStore = useBufferStore.getState();
    const activeBufferId = bufferStore.activeBufferId;

    if (!activeBufferId) {
      logger.warn("Editor", "No active buffer for redo");
      return;
    }

    const activeBuffer = bufferStore.buffers.find((buffer) => buffer.id === activeBufferId);
    if (!activeBuffer || !isEditorContent(activeBuffer)) return;
    const textareaOwningPreviousContent = this.getTextareaOwningContent(activeBuffer.content);

    flushPendingBufferHistory(activeBufferId, activeBuffer.content);

    const historyStore = useHistoryStore.getState();
    const entry = historyStore.actions.redo(
      activeBufferId,
      this.getCurrentHistoryEntry(activeBuffer.content),
    );

    if (entry) {
      // Restore content
      bufferStore.actions.updateBufferContent(activeBufferId, entry.content, false);
      syncBufferHistoryContent(activeBufferId, entry.content);

      if (textareaOwningPreviousContent) {
        textareaOwningPreviousContent.value = entry.content;
      }

      // Restore cursor position if available
      if (entry.cursorPosition) {
        this.setCursorPosition(entry.cursorPosition);
      } else if (textareaOwningPreviousContent) {
        textareaOwningPreviousContent.selectionStart =
          textareaOwningPreviousContent.selectionEnd = 0;
      }

      // Restore selection if it existed
      if (entry.selection) {
        this.setSelection(entry.selection);
      } else {
        this.setSelection(undefined);
      }

      // Emit content change event
      this.emitEvent("contentChange", { content: entry.content, changes: [] });
    }
  }

  canUndo(): boolean {
    const activeBufferId = useBufferStore.getState().activeBufferId;
    if (!activeBufferId) return false;

    return useHistoryStore.getState().actions.canUndo(activeBufferId);
  }

  canRedo(): boolean {
    const activeBufferId = useBufferStore.getState().activeBufferId;
    if (!activeBufferId) return false;

    return useHistoryStore.getState().actions.canRedo(activeBufferId);
  }

  // Settings
  getSettings(): EditorSettings {
    const {
      fontSize,
      lineHeight,
      tabSize,
      lineNumbers,
      wordWrap,
      renderWhitespace,
      renderIndentGuides,
      theme,
    } = useEditorSettingsStore.getState();
    return {
      fontSize,
      lineHeight,
      tabSize,
      lineNumbers,
      wordWrap,
      renderWhitespace,
      renderIndentGuides,
      theme,
    };
  }

  updateSettings(settings: Partial<EditorSettings>): void {
    const store = useEditorSettingsStore.getState();

    if (settings.fontSize !== undefined) {
      store.actions.setFontSize(settings.fontSize);
    }
    if (settings.lineHeight !== undefined) {
      store.actions.setLineHeight(settings.lineHeight);
    }
    if (settings.tabSize !== undefined) {
      store.actions.setTabSize(settings.tabSize);
    }
    if (settings.lineNumbers !== undefined) {
      store.actions.setLineNumbers(settings.lineNumbers);
    }
    if (settings.wordWrap !== undefined) {
      store.actions.setWordWrap(settings.wordWrap);
    }
    if (settings.renderWhitespace !== undefined) {
      store.actions.setRenderWhitespace(settings.renderWhitespace);
    }
    if (settings.renderIndentGuides !== undefined) {
      store.actions.setRenderIndentGuides(settings.renderIndentGuides);
    }

    this.emit("settingsChange", settings);
  }

  // Events
  on<E extends EditorEvent>(event: E, handler: EventHandler<E>): () => void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler as EventHandler<EditorEvent>);
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off<E extends EditorEvent>(event: E, handler: EventHandler<E>): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<EditorEvent>);
    }
  }

  private emit<E extends EditorEvent>(event: E, data: EditorEventPayload[E]): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  // Public method to safely emit events (for extensions)
  emitEvent<E extends EditorEvent>(event: E, data: EditorEventPayload[E]): void {
    this.emit(event, data);
  }

  // Set the textarea ref for syncing cursor position
  setTextareaRef(ref: HTMLTextAreaElement | null): void {
    this.textareaRef = ref;
  }

  getTextareaRef(): HTMLTextAreaElement | null {
    return this.textareaRef;
  }

  // Set the viewport ref for direct scroll manipulation
  setViewportRef(ref: HTMLDivElement | null): void {
    this.viewportRef = ref;
  }

  getViewportRef(): HTMLDivElement | null {
    return this.viewportRef;
  }

  setActiveEditorAdapter(adapter: ActiveEditorAdapter | null): void {
    if (adapter) {
      this.activeEditorAdapter = adapter;
      return;
    }

    this.activeEditorAdapter = null;
  }

  clearActiveEditorAdapter(ownerId: string): void {
    if (this.activeEditorAdapter?.ownerId === ownerId) {
      this.activeEditorAdapter = null;
    }
  }

  private getActiveLineCommentToken(): string {
    const { activeBufferId, buffers } = useBufferStore.getState();
    const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
    const languageId =
      activeBuffer && "language" in activeBuffer && typeof activeBuffer.language === "string"
        ? activeBuffer.language
        : null;

    return getLineCommentTokenForLanguage(languageId);
  }

  private syncSelectionFromOffsets(content: string, selectionStart: number, selectionEnd: number) {
    const cursor = calculateCursorPositionFromContent(selectionStart, content);
    const selection =
      selectionStart === selectionEnd
        ? undefined
        : {
            start: cursor,
            end: calculateCursorPositionFromContent(selectionEnd, content),
          };

    this.cursorPosition = cursor;
    this.selection = selection ?? null;
    useEditorStateStore.getState().actions.setCursorPosition(cursor);
    useEditorStateStore.getState().actions.setSelection(selection);
    this.emit("cursorChange", cursor);
    this.emit("selectionChange", selection ?? null);
  }

  private applyContentEdit(
    previousContent: string,
    nextContent: string,
    selectionStart: number,
    selectionEnd: number,
    editorState = useEditorStateStore.getState(),
  ): void {
    if (nextContent === previousContent) {
      this.syncSelectionFromOffsets(nextContent, selectionStart, selectionEnd);
      return;
    }

    this.smartSelectionHistory = [];

    const textarea = this.getTextareaOwningContent(previousContent);
    if (textarea) {
      textarea.value = nextContent;
      textarea.selectionStart = selectionStart;
      textarea.selectionEnd = selectionEnd;

      const inputEvent = new Event("input", { bubbles: true });
      textarea.dispatchEvent(inputEvent);
      this.syncSelectionFromOffsets(nextContent, selectionStart, selectionEnd);
      return;
    }

    void editorState.onChange(
      nextContent,
      previousContent,
      editorState.cursorPosition,
      editorState.selection,
    );
    this.syncSelectionFromOffsets(nextContent, selectionStart, selectionEnd);
  }

  private applyLineOperation(
    operation: (content: string, offset: number) => LineOperationResult | null,
  ): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const selection = editorState.selection;
    const textarea = this.getTextareaOwningContent(content);

    if (selection && selection.start.offset !== selection.end.offset) return;
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      return;
    }

    const sourceOffset = textarea ? textarea.selectionStart : editorState.cursorPosition.offset;
    const result = operation(content, sourceOffset);
    if (!result || result.content === content) return;

    this.applyContentEdit(
      content,
      result.content,
      result.selectionStart,
      result.selectionEnd,
      editorState,
    );
  }

  private getTextareaOwningContent(content: string): HTMLTextAreaElement | null {
    return this.textareaRef?.value === content ? this.textareaRef : null;
  }
}

// Global editor API instance
export const editorAPI = new EditorAPIImpl();
