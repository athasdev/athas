import { getTokens } from "../lib/rust-api/tokens";
import type { Decoration, LineToken, Token } from "../types/editor-types";
import type { EditorAPI, EditorExtension } from "./extension-types";

const DEBOUNCE_TIME_MS = 300;

class SyntaxHighlighter {
  private editor: EditorAPI;
  private tokens: Token[] = [];
  private decorationIds: string[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private filePath: string | null = null;

  constructor(editor: EditorAPI) {
    this.editor = editor;
  }

  setFilePath(filePath: string) {
    this.filePath = filePath;
    this.updateHighlighting();
  }

  async updateHighlighting() {
    if (!this.filePath) {
      console.log("Syntax highlighting: No file path set");
      return;
    }

    // Clear existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Debounce the update
    this.timeoutId = setTimeout(async () => {
      try {
        const content = this.editor.getContent();
        const extension = this.filePath?.split(".").pop() || "txt";

        console.log(
          `Syntax highlighting: Fetching tokens for .${extension} file, content length: ${content.length}`,
        );

        // Fetch tokens from Rust API
        this.tokens = await getTokens(content, extension);

        console.log(`Syntax highlighting: Received ${this.tokens.length} tokens`);

        // Update decorations
        this.applyDecorations();
      } catch (error) {
        console.error("Syntax highlighting error:", error);
        this.tokens = [];
        this.clearDecorations();
      }
    }, DEBOUNCE_TIME_MS);
  }

  private applyDecorations() {
    // Clear existing decorations
    this.clearDecorations();

    // Convert tokens to decorations
    const decorations = this.createDecorationsFromTokens();

    console.log(`Syntax highlighting: Created ${decorations.length} decorations`);

    // Add new decorations
    this.decorationIds = decorations.map(decoration => this.editor.addDecoration(decoration));

    console.log(`Syntax highlighting: Applied ${this.decorationIds.length} decorations`);
  }

  private clearDecorations() {
    this.decorationIds.forEach(id => this.editor.removeDecoration(id));
    this.decorationIds = [];
  }

  private createDecorationsFromTokens(): Decoration[] {
    const lines = this.editor.getLines();
    const decorations: Decoration[] = [];

    let currentOffset = 0;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const lineLength = line.length;
      const lineStart = currentOffset;
      const lineEnd = currentOffset + lineLength;

      // Find tokens that overlap with this line
      for (const token of this.tokens) {
        if (token.start >= lineEnd) continue;
        if (token.end <= lineStart) continue;

        // Calculate token position within the line
        const tokenStartInLine = Math.max(0, token.start - lineStart);
        const tokenEndInLine = Math.min(lineLength, token.end - lineStart);

        if (tokenStartInLine < tokenEndInLine) {
          decorations.push({
            range: {
              start: {
                line: lineIndex,
                column: tokenStartInLine,
                offset: lineStart + tokenStartInLine,
              },
              end: {
                line: lineIndex,
                column: tokenEndInLine,
                offset: lineStart + tokenEndInLine,
              },
            },
            type: "inline",
            className: `token-${token.class_name}`,
          });
        }
      }

      currentOffset += lineLength + 1; // +1 for newline
    }

    return decorations;
  }

  getLineTokens(lineNumber: number): LineToken[] {
    const lines = this.editor.getLines();
    if (lineNumber < 0 || lineNumber >= lines.length) {
      return [];
    }

    const lineTokens: LineToken[] = [];
    let currentOffset = 0;

    // Calculate offset to the start of the requested line
    for (let i = 0; i < lineNumber; i++) {
      currentOffset += lines[i].length + 1; // +1 for newline
    }

    const lineLength = lines[lineNumber].length;
    const lineStart = currentOffset;
    const lineEnd = currentOffset + lineLength;

    // Find tokens that overlap with this line
    for (const token of this.tokens) {
      if (token.start >= lineEnd) break;
      if (token.end <= lineStart) continue;

      const tokenStartInLine = Math.max(0, token.start - lineStart);
      const tokenEndInLine = Math.min(lineLength, token.end - lineStart);

      if (tokenStartInLine < tokenEndInLine) {
        lineTokens.push({
          startColumn: tokenStartInLine,
          endColumn: tokenEndInLine,
          className: token.class_name,
        });
      }
    }

    return lineTokens;
  }

  dispose() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    this.clearDecorations();
  }
}

let highlighter: SyntaxHighlighter | null = null;

export const syntaxHighlightingExtension: EditorExtension = {
  name: "Syntax Highlighting",
  version: "1.0.0",
  description: "Provides syntax highlighting for various programming languages",

  initialize: (editor: EditorAPI) => {
    highlighter = new SyntaxHighlighter(editor);

    // TODO: Get file path from editor instance
    // For now, we'll update it when content changes
    highlighter.updateHighlighting();
  },

  dispose: () => {
    if (highlighter) {
      highlighter.dispose();
      highlighter = null;
    }
  },

  onContentChange: () => {
    if (highlighter) {
      highlighter.updateHighlighting();
    }
  },

  // Provide decorations dynamically
  decorations: () => {
    // Return empty array since we manage decorations through the editor API
    // The decorations are added directly to the editor's decoration store
    return [];
  },
};

// Export function to set file path (temporary until editor instance provides it)
export function setSyntaxHighlightingFilePath(filePath: string) {
  if (highlighter) {
    highlighter.setFilePath(filePath);
  }
}
