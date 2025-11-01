import { useBufferStore } from "@/features/editor/stores/buffer-store";
import type { LSPPosition, Position } from "@/features/editor/types/editor";
import type { EditorAPI, EditorExtension } from "../types";

interface AutoPair {
  open: string;
  close: string;
  shouldPair?: (context: PairContext) => boolean;
}

interface PairContext {
  beforeCursor: string;
  afterCursor: string;
  lineContent: string;
  position: LSPPosition;
  filePath?: string;
}

export class AutoPairingExtension implements EditorExtension {
  name = "Auto Pairing";
  version = "1.0.0";
  description = "Automatically closes brackets, quotes, and other pairs";

  private editor: EditorAPI | null = null;

  // Define auto-pairs for different languages
  private readonly autoPairs: AutoPair[] = [
    // Brackets
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },

    // Quotes
    {
      open: '"',
      close: '"',
      shouldPair: (ctx) => this.shouldPairQuote(ctx, '"'),
    },
    {
      open: "'",
      close: "'",
      shouldPair: (ctx) => this.shouldPairQuote(ctx, "'"),
    },
    {
      open: "`",
      close: "`",
      shouldPair: (ctx) => this.shouldPairQuote(ctx, "`"),
    },

    // JSX/HTML tags (context-dependent)
    {
      open: "<",
      close: ">",
      shouldPair: (ctx) => this.shouldPairAngleBrackets(ctx),
    },
  ];

  private readonly skipChars = new Set(['"', "'", "`", ")", "]", "}", ">"]);
  private readonly quoteChars = new Set(['"', "'", "`"]);

  async initialize(editor: EditorAPI): Promise<void> {
    this.editor = editor;
  }

  dispose(): void {
    // No manual cleanup needed - handled by extension manager
  }

  onKeyDown = (data: { event: KeyboardEvent; content: string; position: LSPPosition }) => {
    this.handleKeyDown(data);
  };

  private handleKeyDown = (data: {
    event: KeyboardEvent;
    content: string;
    position: LSPPosition;
  }) => {
    const { event, content, position } = data;

    // Don't interfere with modifiers
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const key = event.key;

    // Handle auto-pairing
    if (this.shouldAutoPair(key)) {
      const result = this.handleAutoPair(key, content, position);
      if (result) {
        event.preventDefault();
        this.applyAutoPair(result);
        return;
      }
    }

    // Handle skip-over for closing characters
    if (this.skipChars.has(key)) {
      const result = this.handleSkipOver(key, content, position);
      if (result) {
        event.preventDefault();
        this.applySkipOver(result);
        return;
      }
    }

    // Handle backspace for pair deletion
    if (key === "Backspace") {
      const result = this.handleBackspace(content, position);
      if (result) {
        event.preventDefault();
        this.applyPairDeletion(result);
      }
    }
  };

  private shouldAutoPair(key: string): boolean {
    return this.autoPairs.some((pair) => pair.open === key);
  }

  private handleAutoPair(key: string, content: string, position: LSPPosition) {
    const pair = this.autoPairs.find((p) => p.open === key);
    if (!pair) return null;

    const lines = content.split("\n");
    const currentLineIndex = position.line;
    const currentLine = lines[currentLineIndex] || "";

    // Early exit for quotes that shouldn't be auto-paired
    if (this.isQuote(key) && this.shouldSkipAutoPairQuote(key, currentLine, position)) {
      return null;
    }

    const beforeCursor = currentLine.substring(0, position.character);
    const afterCursor = currentLine.substring(position.character);

    const context: PairContext = {
      beforeCursor,
      afterCursor,
      lineContent: currentLine,
      position,
    };

    // Check if we should pair based on context
    if (pair.shouldPair && !pair.shouldPair(context)) {
      return null;
    }

    // For opening brackets, always pair if not in string/comment
    if (this.isInStringOrComment(beforeCursor)) {
      return null;
    }

    return {
      insertText: key + pair.close,
      newCursorOffset: 1, // Position cursor between the pair
    };
  }

  private handleSkipOver(key: string, content: string, position: LSPPosition) {
    const lines = content.split("\n");
    const currentLine = lines[position.line] || "";

    if (currentLine[position.character] === key) {
      if (this.isQuote(key)) {
        return this.shouldSkipQuote(key, currentLine, position)
          ? {
              skipChar: key,
              newCursorOffset: 1,
            }
          : null;
      }

      return {
        skipChar: key,
        newCursorOffset: 1,
      };
    }

    return null;
  }

  private handleBackspace(content: string, position: LSPPosition) {
    const lines = content.split("\n");
    const currentLine = lines[position.line] || "";

    // Boundary checks
    if (position.character === 0 || position.character > currentLine.length) {
      return null;
    }

    const beforeChar = currentLine[position.character - 1];
    const afterChar = currentLine[position.character];

    // Check if we're deleting a pair
    const pair = this.autoPairs.find((p) => p.open === beforeChar && p.close === afterChar);

    if (pair) {
      return {
        deleteRange: {
          start: {
            line: position.line,
            column: position.character - 1,
            offset: position.offset - 1,
          },
          end: {
            line: position.line,
            column: position.character + 1,
            offset: position.offset + 1,
          },
        },
      };
    }

    return null;
  }

  private shouldPairQuote(context: PairContext, quote: string): boolean {
    const { beforeCursor, afterCursor } = context;

    // Don't pair if we're already inside a string of the same type
    if (this.isInString(beforeCursor, quote)) {
      return false;
    }

    // Don't pair if there's already a quote after cursor
    if (afterCursor.startsWith(quote)) {
      return false;
    }

    // Don't pair if preceded by a letter/number (likely an apostrophe)
    if (quote === "'" && /\w$/.test(beforeCursor)) {
      return false;
    }

    return true;
  }

  private shouldPairAngleBrackets(context: PairContext): boolean {
    const { beforeCursor, afterCursor } = context;

    // Only pair in JSX/TSX/HTML contexts
    const filePath = this.getFilePath();
    if (!filePath || !this.isReactFile(filePath)) {
      return false;
    }

    // Don't pair if it looks like a comparison operator
    if (/\s+$/.test(beforeCursor) && /^\s*[=!<>]/.test(afterCursor)) {
      return false;
    }

    // Don't pair if preceded by = (likely JSX prop)
    if (/=\s*$/.test(beforeCursor)) {
      return false;
    }

    return true;
  }

  private isInStringOrComment(beforeCursor: string): boolean {
    // Simple heuristic - count unescaped quotes
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inTemplate = false;

    for (let i = 0; i < beforeCursor.length; i++) {
      const char = beforeCursor[i];
      const prevChar = i > 0 ? beforeCursor[i - 1] : "";

      if (char === "'" && prevChar !== "\\" && !inDoubleQuote && !inTemplate) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && prevChar !== "\\" && !inSingleQuote && !inTemplate) {
        inDoubleQuote = !inDoubleQuote;
      } else if (char === "`" && prevChar !== "\\" && !inSingleQuote && !inDoubleQuote) {
        inTemplate = !inTemplate;
      }
    }

    return inSingleQuote || inDoubleQuote || inTemplate;
  }

  private isInString(beforeCursor: string, quote: string): boolean {
    let count = 0;
    for (let i = 0; i < beforeCursor.length; i++) {
      if (beforeCursor[i] === quote && (i === 0 || beforeCursor[i - 1] !== "\\")) {
        count++;
      }
    }
    return count % 2 === 1;
  }

  private isReactFile(filePath: string): boolean {
    return /\.(jsx|tsx)$/.test(filePath);
  }

  private isQuote(char: string): boolean {
    return this.quoteChars.has(char);
  }

  private getCharContext(line: string, position: LSPPosition) {
    if (position.character === 0) {
      return { prevChar: "", prevPrevChar: "", isAtStart: true };
    }

    const prevChar = line.charAt(position.character - 1);
    const prevPrevChar = position.character >= 2 ? line.charAt(position.character - 2) : "";

    return { prevChar, prevPrevChar, isAtStart: false };
  }

  private shouldSkipQuote(quote: string, line: string, position: LSPPosition): boolean {
    const { prevChar, prevPrevChar, isAtStart } = this.getCharContext(line, position);

    if (isAtStart) {
      return false;
    }

    return prevChar === quote && prevPrevChar !== quote;
  }

  private shouldSkipAutoPairQuote(quote: string, line: string, position: LSPPosition): boolean {
    const { prevChar, prevPrevChar, isAtStart } = this.getCharContext(line, position);

    if (isAtStart) {
      return false;
    }

    return prevChar === quote && prevPrevChar === quote;
  }

  private getFilePath(): string | undefined {
    // Get file path from editor store - this is a temporary solution
    // In a real implementation, this would be passed through the context
    try {
      const bufferStore = useBufferStore?.getState?.();
      const activeBuffer = bufferStore?.buffers?.find?.(
        (b) => b.id === bufferStore?.activeBufferId,
      );
      return activeBuffer?.path;
    } catch {
      return undefined;
    }
  }

  private applyAutoPair(result: { insertText: string; newCursorOffset: number }) {
    if (!this.editor) return;

    const currentPos = this.editor.getCursorPosition();
    this.editor.insertText(result.insertText, currentPos);

    // Position cursor between the pair
    this.editor.setCursorPosition({
      line: currentPos.line,
      column: currentPos.column + result.newCursorOffset,
      offset: currentPos.offset + result.newCursorOffset,
    });
  }

  private applySkipOver(result: { skipChar: string; newCursorOffset: number }) {
    if (!this.editor) return;

    const currentPos = this.editor.getCursorPosition();
    this.editor.setCursorPosition({
      line: currentPos.line,
      column: currentPos.column + result.newCursorOffset,
      offset: currentPos.offset + result.newCursorOffset,
    });
  }

  private applyPairDeletion(result: { deleteRange: { start: Position; end: Position } }) {
    if (!this.editor) return;

    this.editor.deleteRange(result.deleteRange);
  }
}

export const autoPairingExtension = new AutoPairingExtension();
