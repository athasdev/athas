import { useBufferStore } from "../stores/buffer.store";
import { useEditorDecorationsStore } from "../stores/decorations.store";
import { applyBufferHistory } from "../services/buffer-history-service";
import { captureBufferStoreOwner } from "../services/buffer-store-owner";
import { hasPendingBufferHistory } from "../stores/buffer-history-tracking";
import { useHistoryStore } from "../stores/history.store";
import { useEditorStateStore } from "../stores/state.store";
import { useEditorViewStore } from "../stores/view.store";
import type { HistoryEntry } from "../types/history.types";
import { isEditorContent } from "@/features/panes/types/pane-content.types";
import { isEditorWordWrapEnabled } from "@/features/settings/lib/editor-word-wrap";
import { resolveEffectiveTheme } from "@/features/settings/lib/theme-resolution";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import type { Decoration, Position, Range } from "../types/editor.types";
import {
  findBracketJumpTarget,
  findBracketSelectionRange,
  removeBracketPairAtCursor,
} from "../utils/bracket-matching";
import { toggleLineComment, getLineCommentTokenForLanguage } from "../utils/comment-toggle";
import { logger } from "@/utils/logger";
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
import { getBufferById } from "../utils/buffer-index";
import { readBufferText } from "../services/buffer-text";
import type {
  EditorAPI,
  EditorEvent,
  EditorEventPayload,
  EditorSettings,
  EventHandler,
} from "../types/editor-extension.types";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

export interface ActiveEditorAdapter {
  ownerId: string;
  insertText: (text: string, position?: Position) => void;
  deleteRange: (range: Range) => void;
  replaceRange: (range: Range, text: string) => void;
  selectAll: () => void;
  addSelectionToNextFindMatch?: () => void;
  addSelectionToPreviousFindMatch?: () => void;
  selectAllFindMatches?: () => void;
  insertCursorAbove?: () => void;
  insertCursorBelow?: () => void;
  insertCursorsAtLineEnds?: () => void;
  removeSecondaryCursors?: () => void;
  toggleComment?: () => void;
  duplicateLine?: () => void;
  deleteLine?: () => void;
  moveLineUp?: () => void;
  moveLineDown?: () => void;
  copyLineUp?: () => void;
  copyLineDown?: () => void;
  undo: () => void;
  redo: () => void;
}

export interface ActiveFindAdapter {
  ownerId: string;
  openFind: (replace: boolean) => void;
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
  private viewportRef: HTMLDivElement | null = null;
  private activeEditorAdapter: ActiveEditorAdapter | null = null;
  private activeFindAdapter: ActiveFindAdapter | null = null;
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
    const activeBufferId = getActiveBufferId();
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
    const pos = position || editorState.cursorPosition;
    const before = content.substring(0, pos.offset);
    const after = content.substring(pos.offset);
    const newContent = before + text + after;

    const newOffset = pos.offset + text.length;
    this.applyContentEdit(content, newContent, newOffset, newOffset, editorState, {
      skipUndoGrouping: true,
    });
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
    this.applyContentEdit(content, newContent, newOffset, newOffset, editorState, {
      skipUndoGrouping: true,
    });
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

    this.applyContentEdit(content, before + text + after, newOffset, newOffset, editorState, {
      skipUndoGrouping: true,
    });
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

    // The active editor scrolls the cursor into view when it handles `cursorChange`.
    useEditorStateStore.getState().actions.setCursorPosition(position);
  }

  selectAll(): void {
    if (this.activeEditorAdapter) {
      this.activeEditorAdapter.selectAll();
      return;
    }

    const content = this.getContent();
    this.syncSelectionFromOffsets(content, 0, content.length);
  }

  openFind(replace = false): boolean {
    if (!this.activeFindAdapter) return false;

    this.activeFindAdapter.openFind(replace);
    return true;
  }

  addSelectionToNextFindMatch(): boolean {
    if (!this.activeEditorAdapter?.addSelectionToNextFindMatch) return false;

    this.activeEditorAdapter.addSelectionToNextFindMatch();
    return true;
  }

  addSelectionToPreviousFindMatch(): boolean {
    if (!this.activeEditorAdapter?.addSelectionToPreviousFindMatch) return false;

    this.activeEditorAdapter.addSelectionToPreviousFindMatch();
    return true;
  }

  selectAllFindMatches(): boolean {
    if (!this.activeEditorAdapter?.selectAllFindMatches) return false;

    this.activeEditorAdapter.selectAllFindMatches();
    return true;
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
    const id = useEditorDecorationsStore.getState().actions.addDecoration(decoration);
    this.emit("decorationChange", { type: "add", decoration, id });
    return id;
  }

  removeDecoration(id: string): void {
    useEditorDecorationsStore.getState().actions.removeDecoration(id);
    this.emit("decorationChange", { type: "remove", id });
  }

  updateDecoration(id: string, decoration: Partial<Decoration>): void {
    useEditorDecorationsStore.getState().actions.updateDecoration(id, decoration);
    this.emit("decorationChange", { type: "update", id, decoration });
  }

  clearDecorations(): void {
    useEditorDecorationsStore.getState().actions.clearDecorations();
    this.emit("decorationChange", { type: "clear" });
  }

  // Line operations
  getLines(): string[] {
    return useEditorViewStore.getState().actions.getLines();
  }

  getLine(lineNumber: number): string | undefined {
    const lineIndex = Math.trunc(lineNumber);
    if (!Number.isFinite(lineNumber) || lineIndex < 0) return undefined;

    return useEditorViewStore.getState().actions.getLines()[lineIndex];
  }

  getLineCount(): number {
    return useEditorViewStore.getState().actions.getLineCount();
  }

  duplicateLine(): void {
    if (this.activeEditorAdapter?.duplicateLine) {
      this.activeEditorAdapter.duplicateLine();
      return;
    }

    this.applyLineOperation(duplicateLineOperation);
  }

  deleteLine(): void {
    if (this.activeEditorAdapter?.deleteLine) {
      this.activeEditorAdapter.deleteLine();
      return;
    }

    this.applyLineOperation(deleteLineOperation);
  }

  toggleComment(): void {
    if (this.activeEditorAdapter?.toggleComment) {
      this.activeEditorAdapter.toggleComment();
      return;
    }

    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const selectionStart = editorState.selection?.start.offset ?? editorState.cursorPosition.offset;
    const selectionEnd = editorState.selection?.end.offset ?? editorState.cursorPosition.offset;

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
      { skipUndoGrouping: true },
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
      { skipUndoGrouping: true },
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
    if (this.activeEditorAdapter?.insertCursorAbove) {
      this.activeEditorAdapter.insertCursorAbove();
      return;
    }

    this.insertCursorVertical(-1);
  }

  insertCursorBelow(): void {
    if (this.activeEditorAdapter?.insertCursorBelow) {
      this.activeEditorAdapter.insertCursorBelow();
      return;
    }

    this.insertCursorVertical(1);
  }

  insertCursorsAtLineEnds(): void {
    if (this.activeEditorAdapter?.insertCursorsAtLineEnds) {
      this.activeEditorAdapter.insertCursorsAtLineEnds();
      return;
    }

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
  }

  removeSecondaryCursors(): void {
    if (this.activeEditorAdapter?.removeSecondaryCursors) {
      this.activeEditorAdapter.removeSecondaryCursors();
      return;
    }

    useEditorStateStore.getState().actions.clearSecondaryCursors();
  }

  moveLineUp(): void {
    if (this.activeEditorAdapter?.moveLineUp) {
      this.activeEditorAdapter.moveLineUp();
      return;
    }

    this.applyLineOperation(moveLineUpOperation);
  }

  moveLineDown(): void {
    if (this.activeEditorAdapter?.moveLineDown) {
      this.activeEditorAdapter.moveLineDown();
      return;
    }

    this.applyLineOperation(moveLineDownOperation);
  }

  copyLineUp(): void {
    if (this.activeEditorAdapter?.copyLineUp) {
      this.activeEditorAdapter.copyLineUp();
      return;
    }

    this.applyLineOperation(copyLineUpOperation);
  }

  copyLineDown(): void {
    if (this.activeEditorAdapter?.copyLineDown) {
      this.activeEditorAdapter.copyLineDown();
      return;
    }

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
    const activeBufferId = getActiveBufferId();

    if (!activeBufferId) {
      logger.warn("Editor", "No active buffer for undo");
      return;
    }

    const activeBuffer = getBufferById(bufferStore.buffers, activeBufferId);
    if (!activeBuffer || !isEditorContent(activeBuffer)) return;

    const entry = applyBufferHistory(
      captureBufferStoreOwner(),
      activeBufferId,
      "undo",
      this.getCurrentHistoryEntry(readBufferText(activeBuffer)),
    );

    if (entry) {
      // Restore cursor position if available
      if (entry.cursorPosition) {
        this.setCursorPosition(entry.cursorPosition);
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
    const activeBufferId = getActiveBufferId();

    if (!activeBufferId) {
      logger.warn("Editor", "No active buffer for redo");
      return;
    }

    const activeBuffer = getBufferById(bufferStore.buffers, activeBufferId);
    if (!activeBuffer || !isEditorContent(activeBuffer)) return;

    const entry = applyBufferHistory(
      captureBufferStoreOwner(),
      activeBufferId,
      "redo",
      this.getCurrentHistoryEntry(readBufferText(activeBuffer)),
    );

    if (entry) {
      // Restore cursor position if available
      if (entry.cursorPosition) {
        this.setCursorPosition(entry.cursorPosition);
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
    const activeBufferId = getActiveBufferId();
    if (!activeBufferId) return false;

    const buffer = getBufferById(useBufferStore.getState().buffers, activeBufferId);
    if (!buffer || buffer.type !== "editor" || buffer.readOnly || buffer.isVirtual) return false;
    return (
      hasPendingBufferHistory(activeBufferId) ||
      useHistoryStore.getState().actions.canUndo(activeBufferId)
    );
  }

  canRedo(): boolean {
    const activeBufferId = getActiveBufferId();
    if (!activeBufferId) return false;

    const buffer = getBufferById(useBufferStore.getState().buffers, activeBufferId);
    if (!buffer || buffer.type !== "editor" || buffer.readOnly || buffer.isVirtual) return false;
    return useHistoryStore.getState().actions.canRedo(activeBufferId);
  }

  // Settings
  getSettings(): EditorSettings {
    const { settings } = useSettingsStore.getState();
    return {
      fontSize: settings.fontSize,
      lineHeight: settings.editorLineHeight,
      tabSize: settings.tabSize,
      lineNumbers: settings.lineNumbers,
      wordWrap: isEditorWordWrapEnabled(settings),
      renderWhitespace: settings.renderWhitespace,
      renderIndentGuides: settings.renderIndentGuides,
      theme: resolveEffectiveTheme(settings),
    };
  }

  updateSettings(settings: Partial<EditorSettings>): void {
    const { updateSetting } = useSettingsStore.getState().actions;

    if (settings.fontSize !== undefined) {
      void updateSetting("fontSize", settings.fontSize);
    }
    if (settings.lineHeight !== undefined) {
      void updateSetting("editorLineHeight", settings.lineHeight);
    }
    if (settings.tabSize !== undefined) {
      void updateSetting("tabSize", settings.tabSize);
    }
    if (settings.lineNumbers !== undefined) {
      void updateSetting("lineNumbers", settings.lineNumbers);
    }
    if (settings.wordWrap !== undefined) {
      void updateSetting("wordWrap", settings.wordWrap);
    }
    if (settings.renderWhitespace !== undefined) {
      void updateSetting("renderWhitespace", settings.renderWhitespace);
    }
    if (settings.renderIndentGuides !== undefined) {
      void updateSetting("renderIndentGuides", settings.renderIndentGuides);
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

  setActiveFindAdapter(adapter: ActiveFindAdapter | null): void {
    this.activeFindAdapter = adapter;
  }

  clearActiveFindAdapter(ownerId: string): void {
    if (this.activeFindAdapter?.ownerId === ownerId) {
      this.activeFindAdapter = null;
    }
  }

  private getActiveLineCommentToken(): string {
    const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
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
    options: { skipUndoGrouping?: boolean } = {},
  ): void {
    if (nextContent === previousContent) {
      this.syncSelectionFromOffsets(nextContent, selectionStart, selectionEnd);
      return;
    }

    this.smartSelectionHistory = [];

    void editorState.onChange(
      nextContent,
      previousContent,
      editorState.cursorPosition,
      editorState.selection,
      options.skipUndoGrouping ? { skipUndoGrouping: true } : undefined,
    );
    this.syncSelectionFromOffsets(nextContent, selectionStart, selectionEnd);
  }

  private applyLineOperation(
    operation: (content: string, offset: number) => LineOperationResult | null,
  ): void {
    const content = this.getContent();
    const editorState = useEditorStateStore.getState();
    const selection = editorState.selection;

    if (selection && selection.start.offset !== selection.end.offset) return;

    const result = operation(content, editorState.cursorPosition.offset);
    if (!result || result.content === content) return;

    this.applyContentEdit(
      content,
      result.content,
      result.selectionStart,
      result.selectionEnd,
      editorState,
      { skipUndoGrouping: true },
    );
  }
}

// Global editor API instance
export const editorAPI = new EditorAPIImpl();
