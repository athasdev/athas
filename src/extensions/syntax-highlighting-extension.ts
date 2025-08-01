import { shikiHighlighter, type Token } from "../lib/syntax-highlighting/shiki-highlighter";
import { tokenService } from "../lib/syntax-highlighting/token-service";
import { treeSitterHighlighter } from "../lib/syntax-highlighting/tree-sitter-highlighter";
import { useBufferStore } from "../stores/buffer-store";
import type { Change } from "../types/editor-types";
import type { EditorAPI, EditorExtension } from "./extension-types";

const DEBOUNCE_TIME_MS = 150; // Reduced debounce for better responsiveness
const MAX_INCREMENTAL_LINES = 50; // Maximum lines to highlight incrementally
const TREE_SITTER_FILE_SIZE_THRESHOLD = 10000; // Use Tree-sitter for files larger than 10KB

class SyntaxHighlighter {
  private editor: EditorAPI;
  private lineTokens: Map<number, Token[]> = new Map();
  private timeoutId: NodeJS.Timeout | null = null;
  private filePath: string | null = null;
  private pendingAffectedLines: Set<number> = new Set();
  private lastContent: string = "";
  private isInitialized: boolean = false;

  constructor(editor: EditorAPI) {
    this.editor = editor;
    this.initializeShiki();
  }

  private async initializeShiki() {
    try {
      await shikiHighlighter.initialize();
      await treeSitterHighlighter.initialize();
      this.isInitialized = true;
    } catch (error) {
      console.error("Failed to initialize syntax highlighters:", error);
    }
  }

  /**
   * Choose the appropriate highlighter based on file characteristics
   */
  private shouldUseTreeSitter(content: string, filePath: string): boolean {
    if (!filePath) return false;

    // Use Tree-sitter for large files
    if (content.length > TREE_SITTER_FILE_SIZE_THRESHOLD) {
      return treeSitterHighlighter.isSupportedLanguage(filePath);
    }

    // Use Tree-sitter for supported languages in static files for better performance
    // Still prefer Shiki for smaller files due to better theme support
    return false;
  }

  setFilePath(filePath: string) {
    this.filePath = filePath;
    this.lineTokens.clear();
    this.lastContent = "";
    this.pendingAffectedLines.clear();
    // When switching files, try to use cached tokens immediately
    this.updateHighlighting(true);
  }

  async updateHighlighting(immediate = false, affectedLines?: Set<number>) {
    if (!this.filePath || !this.isInitialized) {
      return;
    }

    const content = this.editor.getContent();

    // Check if we have cached tokens for the current buffer
    const bufferStore = useBufferStore.getState();
    const activeBuffer = bufferStore.actions.getActiveBuffer();

    // Use cached tokens if available and content hasn't changed significantly
    if (activeBuffer && activeBuffer.path === this.filePath && this.lastContent === content) {
      this.loadCachedTokens(activeBuffer);
      this.applyDecorations(affectedLines);
      return;
    }

    // Clear existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // Accumulate affected lines for incremental updates
    if (affectedLines) {
      affectedLines.forEach((line) => this.pendingAffectedLines.add(line));
    }

    // If immediate flag is set or it's a new file, highlight without debounce
    if (immediate || this.lastContent === "") {
      await this.performHighlighting(content, immediate);
    } else {
      // Debounce the update for better performance during typing
      this.timeoutId = setTimeout(async () => {
        await this.performHighlighting(content, false);
      }, DEBOUNCE_TIME_MS);
    }
  }

  private loadCachedTokens(buffer: any) {
    // Convert buffer tokens to line-based tokens
    this.lineTokens.clear();

    buffer.tokens.forEach((token: any) => {
      if (typeof token.line === "number") {
        if (!this.lineTokens.has(token.line)) {
          this.lineTokens.set(token.line, []);
        }
        this.lineTokens.get(token.line)!.push(token);
      }
    });
  }

  private async performHighlighting(content: string, isFullHighlight: boolean) {
    try {
      const extension = this.filePath?.split(".").pop() || "txt";
      const useTreeSitter = this.shouldUseTreeSitter(content, this.filePath || "");

      let updatedLines: Map<number, Token[]>;

      if (
        isFullHighlight ||
        this.pendingAffectedLines.size === 0 ||
        this.pendingAffectedLines.size > MAX_INCREMENTAL_LINES
      ) {
        // Full document highlighting for new files or major changes
        if (useTreeSitter) {
          // Use Tree-sitter for better performance on large files
          const result = await treeSitterHighlighter.highlightContent(content, this.filePath!);
          this.lineTokens = result.lineTokens;
          updatedLines = result.lineTokens;
        } else {
          // Use Shiki for smaller files and better theme support
          const result = await shikiHighlighter.highlightCode(content, extension);
          this.lineTokens = result.lineTokens;
          updatedLines = result.lineTokens;
        }
      } else {
        // Incremental highlighting for small changes
        if (useTreeSitter) {
          // Tree-sitter incremental highlighting
          const startLine = Math.min(...this.pendingAffectedLines);
          const endLine = Math.max(...this.pendingAffectedLines);
          updatedLines = await treeSitterHighlighter.highlightLines(
            content,
            this.filePath!,
            startLine,
            endLine,
          );
        } else {
          // Shiki incremental highlighting
          updatedLines = await shikiHighlighter.highlightIncremental(
            content,
            extension,
            this.pendingAffectedLines,
          );
        }

        // Merge incremental results with existing tokens
        updatedLines.forEach((tokens, lineNumber) => {
          this.lineTokens.set(lineNumber, tokens);
        });
      }

      // Update last content and clear pending lines
      this.lastContent = content;
      this.pendingAffectedLines.clear();

      // Update the centralized token service
      tokenService.updateLineTokens(this.lineTokens);

      // Apply decorations only to updated lines for better performance
      this.applyDecorations(new Set(updatedLines.keys()));
    } catch (error) {
      console.error("Syntax highlighting error:", error);
      // Fallback to Shiki if Tree-sitter fails
      if (this.filePath && error instanceof Error && error.message?.includes("tree-sitter")) {
        console.warn("Tree-sitter failed, falling back to Shiki");
        try {
          const extension = this.filePath.split(".").pop() || "txt";
          const result = await shikiHighlighter.highlightCode(content, extension);
          this.lineTokens = result.lineTokens;
          this.applyDecorations(new Set(result.lineTokens.keys()));
        } catch (fallbackError) {
          console.error("Fallback highlighting also failed:", fallbackError);
          this.lineTokens.clear();
        }
      } else {
        this.lineTokens.clear();
      }
    }
  }

  // Token caching is now handled efficiently in the lineTokens Map
  // No need for redundant buffer store caching

  private applyDecorations(affectedLines?: Set<number>) {
    // Apply syntax highlighting decorations to the editor
    // This now works with line-based tokens for better performance

    if (!affectedLines || affectedLines.size === 0) {
      // Apply all tokens if no specific lines are affected
      this.editor.clearDecorations();
      this.lineTokens.forEach((tokens, lineNumber) => {
        this.applyLineDecorations(lineNumber, tokens);
      });
    } else {
      // Apply decorations only to affected lines for better performance
      affectedLines.forEach((lineNumber) => {
        const tokens = this.lineTokens.get(lineNumber) || [];
        this.applyLineDecorations(lineNumber, tokens);
      });
    }
  }

  private applyLineDecorations(lineNumber: number, tokens: Token[]) {
    // Convert tokens to editor decorations
    tokens.forEach((token) => {
      this.editor.addDecoration({
        type: "inline",
        range: {
          start: { line: lineNumber, column: token.startColumn, offset: 0 },
          end: { line: lineNumber, column: token.endColumn, offset: 0 },
        },
        className: token.class_name,
      });
    });
  }

  dispose() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
  }
}

let highlighter: SyntaxHighlighter | null = null;

export const syntaxHighlightingExtension: EditorExtension = {
  name: "Syntax Highlighting",
  version: "1.0.0",
  description: "Provides syntax highlighting for various programming languages",

  initialize: (editor: EditorAPI) => {
    highlighter = new SyntaxHighlighter(editor);
    highlighter.updateHighlighting();
  },

  dispose: () => {
    if (highlighter) {
      highlighter.dispose();
      highlighter = null;
    }
  },

  onContentChange: (_content: string, _changes: Change[], affectedLines?: Set<number>) => {
    if (highlighter) {
      highlighter.updateHighlighting(false, affectedLines);
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
