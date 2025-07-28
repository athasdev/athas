import { getTokens, type Token } from "../lib/rust-api/tokens";
import { useBufferStore } from "../stores/buffer-store";
// No longer need editor-content-store - tokens are stored in buffer-store
import type { Change } from "../types/editor-types";
import type { EditorAPI, EditorExtension } from "./extension-types";

const DEBOUNCE_TIME_MS = 300;

class SyntaxHighlighter {
  private editor: EditorAPI;
  private tokens: Token[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private filePath: string | null = null;
  private pendingAffectedLines: Set<number> | undefined = undefined;

  constructor(editor: EditorAPI) {
    this.editor = editor;
  }

  setFilePath(filePath: string) {
    this.filePath = filePath;
    // When switching files, try to use cached tokens immediately
    this.updateHighlighting(true);
  }

  async updateHighlighting(immediate = false, affectedLines?: Set<number>) {
    if (!this.filePath) {
      return;
    }

    // Check if we have cached tokens for the current buffer
    const bufferStore = useBufferStore.getState();
    const activeBuffer = bufferStore.actions.getActiveBuffer();

    if (activeBuffer && activeBuffer.path === this.filePath && activeBuffer.tokens.length > 0) {
      // Use cached tokens immediately
      this.tokens = activeBuffer.tokens;
      this.applyDecorations(affectedLines);

      // If not immediate (regular content change), still fetch new tokens in background
      if (!immediate) {
        // Clear existing timeout
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
        }

        // Accumulate affected lines for the debounced update
        if (affectedLines) {
          if (!this.pendingAffectedLines) {
            this.pendingAffectedLines = new Set();
          }
          affectedLines.forEach((line) => this.pendingAffectedLines!.add(line));
        }

        this.timeoutId = setTimeout(async () => {
          const linesToUpdate = this.pendingAffectedLines;
          this.pendingAffectedLines = undefined;
          await this.fetchAndCacheTokens(linesToUpdate);
        }, DEBOUNCE_TIME_MS);
      }
      return;
    }

    // Clear existing timeout
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    // If immediate flag is set, fetch without debounce
    if (immediate) {
      await this.fetchAndCacheTokens();
    } else {
      // Accumulate affected lines for the debounced update
      if (affectedLines) {
        if (!this.pendingAffectedLines) {
          this.pendingAffectedLines = new Set();
        }
        affectedLines.forEach((line) => this.pendingAffectedLines!.add(line));
      }

      // Debounce the update
      this.timeoutId = setTimeout(async () => {
        const linesToUpdate = this.pendingAffectedLines;
        this.pendingAffectedLines = undefined;
        await this.fetchAndCacheTokens(linesToUpdate);
      }, DEBOUNCE_TIME_MS);
    }
  }

  private async fetchAndCacheTokens(affectedLines?: Set<number>) {
    try {
      const content = this.editor.getContent();
      const extension = this.filePath?.split(".").pop() || "txt";

      // Fetch tokens from Rust API
      this.tokens = await getTokens(content, extension);

      // Cache tokens in buffer store
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.actions.getActiveBuffer();
      if (activeBuffer) {
        bufferStore.actions.updateBufferTokens(activeBuffer.id, this.tokens);
      }

      // Update decorations - pass affected lines to avoid full re-render
      this.applyDecorations(affectedLines);
    } catch (error) {
      console.error("Syntax highlighting error:", error);
      this.tokens = [];
    }
  }

  private applyDecorations(_affectedLines?: Set<number>) {
    // Tokens are stored in buffer-store and automatically
    // converted to line tokens by editor-view-store
    // Nothing to do here anymore
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
