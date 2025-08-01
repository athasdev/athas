import { PieceTree, type Position, type TextChange } from "./piece-tree";

export interface Range {
  start: Position;
  end: Position;
}

export interface TextBufferManager {
  getText(): string;
  getLines(): string[];
  getLineContent(lineNumber: number): string;
  getLineCount(): number;
  getLength(): number;

  insert(offset: number, text: string): TextChange[];
  delete(offset: number, length: number): TextChange[];
  replace(start: number, end: number, text: string): TextChange[];

  offsetToPosition(offset: number): Position;
  positionToOffset(position: Position): number;

  getTextInRange(start: number, end: number): string;
  getTextInRangeByRange(range: Range): string;

  // Additional utility methods
  insertAtPosition(position: Position, text: string): TextChange[];
  deleteRange(range: Range): TextChange[];
  replaceRange(range: Range, text: string): TextChange[];
}

/**
 * High-performance text buffer using piece tree data structure
 */
export class PieceTreeTextBuffer implements TextBufferManager {
  private pieceTree: PieceTree;
  private changeListeners: ((changes: TextChange[]) => void)[] = [];

  constructor(initialContent: string = "") {
    this.pieceTree = new PieceTree(initialContent);
  }

  getText(): string {
    return this.pieceTree.getText();
  }

  getLines(): string[] {
    return this.pieceTree.getLines();
  }

  getLineContent(lineNumber: number): string {
    return this.pieceTree.getLineContent(lineNumber);
  }

  getLineCount(): number {
    return this.pieceTree.lineCount;
  }

  getLength(): number {
    return this.pieceTree.length;
  }

  insert(offset: number, text: string): TextChange[] {
    const changes = this.pieceTree.insert(offset, text);
    this.notifyChanges(changes);
    return changes;
  }

  delete(offset: number, length: number): TextChange[] {
    const changes = this.pieceTree.delete(offset, length);
    this.notifyChanges(changes);
    return changes;
  }

  replace(start: number, end: number, text: string): TextChange[] {
    const changes = this.pieceTree.replace(start, end, text);
    this.notifyChanges(changes);
    return changes;
  }

  offsetToPosition(offset: number): Position {
    return this.pieceTree.offsetToPosition(offset);
  }

  positionToOffset(position: Position): number {
    return this.pieceTree.positionToOffset(position);
  }

  getTextInRange(start: number, end: number): string {
    return this.pieceTree.getTextInRange(start, end);
  }

  getTextInRangeByRange(range: Range): string {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.getTextInRange(startOffset, endOffset);
  }

  insertAtPosition(position: Position, text: string): TextChange[] {
    const offset = this.positionToOffset(position);
    return this.insert(offset, text);
  }

  deleteRange(range: Range): TextChange[] {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.delete(startOffset, endOffset - startOffset);
  }

  replaceRange(range: Range, text: string): TextChange[] {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.replace(startOffset, endOffset, text);
  }

  /**
   * Add a change listener
   */
  onDidChangeContent(listener: (changes: TextChange[]) => void): () => void {
    this.changeListeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index >= 0) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  private notifyChanges(changes: TextChange[]): void {
    if (changes.length > 0) {
      this.changeListeners.forEach((listener) => {
        try {
          listener(changes);
        } catch (error) {
          console.error("Error in text buffer change listener:", error);
        }
      });
    }
  }
}

/**
 * Simple string-based text buffer for compatibility
 * This is the current implementation - kept for fallback
 */
export class StringTextBuffer implements TextBufferManager {
  private content: string;
  private changeListeners: ((changes: TextChange[]) => void)[] = [];

  constructor(initialContent: string = "") {
    this.content = initialContent;
  }

  getText(): string {
    return this.content;
  }

  getLines(): string[] {
    return this.content.split("\n");
  }

  getLineContent(lineNumber: number): string {
    const lines = this.getLines();
    return lines[lineNumber] || "";
  }

  getLineCount(): number {
    return this.getLines().length;
  }

  getLength(): number {
    return this.content.length;
  }

  insert(offset: number, text: string): TextChange[] {
    const before = this.content.substring(0, offset);
    const after = this.content.substring(offset);
    this.content = before + text + after;

    const changes: TextChange[] = [
      {
        range: {
          start: this.offsetToPosition(offset),
          end: this.offsetToPosition(offset),
        },
        text,
        rangeLength: 0,
      },
    ];

    this.notifyChanges(changes);
    return changes;
  }

  delete(offset: number, length: number): TextChange[] {
    const before = this.content.substring(0, offset);
    const after = this.content.substring(offset + length);
    this.content = before + after;

    const changes: TextChange[] = [
      {
        range: {
          start: this.offsetToPosition(offset),
          end: this.offsetToPosition(offset + length),
        },
        text: "",
        rangeLength: length,
      },
    ];

    this.notifyChanges(changes);
    return changes;
  }

  replace(start: number, end: number, text: string): TextChange[] {
    const before = this.content.substring(0, start);
    const after = this.content.substring(end);
    this.content = before + text + after;

    const changes: TextChange[] = [
      {
        range: {
          start: this.offsetToPosition(start),
          end: this.offsetToPosition(end),
        },
        text,
        rangeLength: end - start,
      },
    ];

    this.notifyChanges(changes);
    return changes;
  }

  offsetToPosition(offset: number): Position {
    if (offset <= 0) {
      return { line: 0, column: 0, offset: 0 };
    }
    if (offset >= this.content.length) {
      const lines = this.getLines();
      const lastLine = lines.length - 1;
      return {
        line: lastLine,
        column: lines[lastLine]?.length || 0,
        offset: this.content.length,
      };
    }

    const beforeOffset = this.content.substring(0, offset);
    const lines = beforeOffset.split("\n");
    const line = lines.length - 1;
    const column = lines[line]?.length || 0;

    return { line, column, offset };
  }

  positionToOffset(position: Position): number {
    const lines = this.getLines();
    if (position.line < 0 || position.line >= lines.length) {
      return 0;
    }

    let offset = 0;
    for (let i = 0; i < position.line; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += Math.min(position.column, lines[position.line]?.length || 0);

    return Math.min(offset, this.content.length);
  }

  getTextInRange(start: number, end: number): string {
    return this.content.substring(start, end);
  }

  getTextInRangeByRange(range: Range): string {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.getTextInRange(startOffset, endOffset);
  }

  insertAtPosition(position: Position, text: string): TextChange[] {
    const offset = this.positionToOffset(position);
    return this.insert(offset, text);
  }

  deleteRange(range: Range): TextChange[] {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.delete(startOffset, endOffset - startOffset);
  }

  replaceRange(range: Range, text: string): TextChange[] {
    const startOffset = this.positionToOffset(range.start);
    const endOffset = this.positionToOffset(range.end);
    return this.replace(startOffset, endOffset, text);
  }

  onDidChangeContent(listener: (changes: TextChange[]) => void): () => void {
    this.changeListeners.push(listener);

    return () => {
      const index = this.changeListeners.indexOf(listener);
      if (index >= 0) {
        this.changeListeners.splice(index, 1);
      }
    };
  }

  private notifyChanges(changes: TextChange[]): void {
    if (changes.length > 0) {
      this.changeListeners.forEach((listener) => {
        try {
          listener(changes);
        } catch (error) {
          console.error("Error in text buffer change listener:", error);
        }
      });
    }
  }
}

/**
 * Factory function to create the appropriate text buffer
 */
export function createTextBuffer(
  initialContent: string = "",
  usePieceTree: boolean = true,
): TextBufferManager {
  if (usePieceTree) {
    return new PieceTreeTextBuffer(initialContent);
  } else {
    return new StringTextBuffer(initialContent);
  }
}
