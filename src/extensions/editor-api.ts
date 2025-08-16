import { EDITOR_CONSTANTS } from "../constants/editor-constants";
import { useBufferStore } from "../stores/buffer-store";
import { useEditorCursorStore } from "../stores/editor-cursor-store";
import { useEditorDecorationsStore } from "../stores/editor-decorations-store";
import { useEditorSettingsStore } from "../stores/editor-settings-store";
import { useEditorViewStore } from "../stores/editor-view-store";
import type { Decoration, Position, Range } from "../types/editor-types";
import type { EditorAPI, EditorEvent, EditorSettings, EventHandler } from "./extension-types";

class EditorAPIImpl implements EditorAPI {
  private eventHandlers: Map<EditorEvent, Set<EventHandler>> = new Map();
  private cursorPosition: Position = { line: 0, column: 0, offset: 0 };
  private selection: Range | null = null;
  private textareaRef: HTMLTextAreaElement | null = null;
  private viewportRef: HTMLDivElement | null = null;

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
    const content = this.getContent();
    const pos = position || this.getCursorPosition();
    const before = content.substring(0, pos.offset);
    const after = content.substring(pos.offset);
    const newContent = before + text + after;

    // Calculate new cursor position first
    const newOffset = pos.offset + text.length;
    const newPos = this.offsetToPosition(newOffset);

    // Update textarea selection BEFORE setting content
    if (this.textareaRef) {
      // Set the value directly on the textarea
      this.textareaRef.value = newContent;
      // Set selection to new position
      this.textareaRef.selectionStart = this.textareaRef.selectionEnd = newOffset;

      // Now trigger the change event so React updates
      const event = new Event("input", { bubbles: true });
      this.textareaRef.dispatchEvent(event);
    } else {
      // Fallback if no textarea ref
      this.setContent(newContent);
      this.setCursorPosition(newPos);
    }
  }

  deleteRange(range: Range): void {
    const content = this.getContent();
    const before = content.substring(0, range.start.offset);
    const after = content.substring(range.end.offset);
    const newContent = before + after;

    // Calculate new cursor position
    const newOffset = range.start.offset;

    // Update textarea directly for better responsiveness
    if (this.textareaRef) {
      this.textareaRef.value = newContent;
      this.textareaRef.selectionStart = this.textareaRef.selectionEnd = newOffset;

      // Trigger change event
      const event = new Event("input", { bubbles: true });
      this.textareaRef.dispatchEvent(event);
    } else {
      this.setContent(newContent);
      this.setCursorPosition(this.offsetToPosition(newOffset));
    }
  }

  replaceRange(range: Range, text: string): void {
    const content = this.getContent();
    const before = content.substring(0, range.start.offset);
    const after = content.substring(range.end.offset);
    this.setContent(before + text + after);
  }

  // Selection operations
  getSelection(): Range | null {
    return this.selection;
  }

  setSelection(range: Range): void {
    this.selection = range;
    this.emit("selectionChange", range);
  }

  getCursorPosition(): Position {
    return this.cursorPosition;
  }

  setCursorPosition(position: Position): void {
    this.cursorPosition = position;
    this.emit("cursorChange", position);

    // Update cursor store to trigger UI updates
    useEditorCursorStore.getState().actions.setCursorPosition(position);

    // Sync with textarea if available
    if (this.textareaRef) {
      this.textareaRef.selectionStart = this.textareaRef.selectionEnd = position.offset;
    }

    // Direct viewport scrolling for immediate response
    if (this.viewportRef) {
      const fontSize = this.getSettings().fontSize;
      const lineHeight = EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER * fontSize;
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
    return useEditorViewStore.getState().lines;
  }

  getLine(lineNumber: number): string | undefined {
    return this.getLines()[lineNumber];
  }

  getLineCount(): number {
    return this.getLines().length;
  }

  // History operations (TODO: Implement when history store is ready)
  undo(): void {
    console.warn("Undo not yet implemented");
  }

  redo(): void {
    console.warn("Redo not yet implemented");
  }

  canUndo(): boolean {
    return false;
  }

  canRedo(): boolean {
    return false;
  }

  // Settings
  getSettings(): EditorSettings {
    const { fontSize, tabSize, lineNumbers, wordWrap } = useEditorSettingsStore.getState();
    return {
      fontSize,
      tabSize,
      lineNumbers,
      wordWrap,
      theme: "default", // TODO: Implement theme support
    };
  }

  updateSettings(settings: Partial<EditorSettings>): void {
    const store = useEditorSettingsStore.getState();

    if (settings.fontSize !== undefined) {
      store.actions.setFontSize(settings.fontSize);
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

    this.emit("settingsChange", settings);
  }

  // Events
  on(event: EditorEvent, handler: EventHandler): () => void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.add(handler);
    }

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off(event: EditorEvent, handler: EventHandler): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private emit(event: EditorEvent, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(data));
    }
  }

  // Public method to safely emit events (for extensions)
  emitEvent(event: EditorEvent, data?: any): void {
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

  private offsetToPosition(offset: number): Position {
    const content = this.getContent();
    const lines = content.split("\n");
    let currentOffset = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineLength = lines[i].length + (i < lines.length - 1 ? 1 : 0);
      if (currentOffset + lineLength >= offset) {
        return {
          line: i,
          column: offset - currentOffset,
          offset,
        };
      }
      currentOffset += lineLength;
    }

    return {
      line: lines.length - 1,
      column: lines[lines.length - 1].length,
      offset: content.length,
    };
  }
}

// Global editor API instance
export const editorAPI = new EditorAPIImpl();
