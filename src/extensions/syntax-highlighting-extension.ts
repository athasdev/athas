import type { Token } from "../lib/rust-api/tokens";
import { useBufferStore } from "../stores/buffer-store";
import type { Change } from "../types/editor-types";
import { extensionManager } from "./extension-manager";
import type { EditorAPI, EditorExtension } from "./extension-types";

const DEBOUNCE_TIME_MS = 16; // ~1 frame at 60fps for near-instant highlighting

class SyntaxHighlighter {
  private editor: EditorAPI;
  private tokens: Token[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private rafId: number | null = null;
  private filePath: string | null = null;
  private pendingAffectedLines: Set<number> | undefined = undefined;
  private abortController: AbortController | null = null;

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

    // Cancel any pending fetch operations
    if (this.abortController) {
      this.abortController.abort();
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
        // Clear existing timeout and RAF
        if (this.timeoutId) {
          clearTimeout(this.timeoutId);
        }
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
        }

        // Accumulate affected lines for the debounced update
        if (affectedLines) {
          if (!this.pendingAffectedLines) {
            this.pendingAffectedLines = new Set();
          }
          affectedLines.forEach((line) => this.pendingAffectedLines!.add(line));
        }

        // Use RAF for smoother updates
        this.rafId = requestAnimationFrame(() => {
          this.timeoutId = setTimeout(async () => {
            const linesToUpdate = this.pendingAffectedLines;
            this.pendingAffectedLines = undefined;
            await this.fetchAndCacheTokens(linesToUpdate);
          }, DEBOUNCE_TIME_MS);
        });
      }
      return;
    }

    // Clear existing timeout and RAF
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
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

      // Use RAF + debounce for optimal responsiveness
      this.rafId = requestAnimationFrame(() => {
        this.timeoutId = setTimeout(async () => {
          const linesToUpdate = this.pendingAffectedLines;
          this.pendingAffectedLines = undefined;
          await this.fetchAndCacheTokens(linesToUpdate);
        }, DEBOUNCE_TIME_MS);
      });
    }
  }

  private async fetchAndCacheTokens(affectedLines?: Set<number>) {
    // Create new abort controller for this fetch
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    try {
      const content = this.editor.getContent();
      const extension = this.filePath?.split(".").pop() || "txt";

      // Check if aborted before proceeding
      if (signal.aborted) return;

      // Get language provider from extension manager
      const languageProvider = extensionManager.getLanguageProvider(extension);

      if (!languageProvider) {
        console.warn("[SyntaxHighlighter] No language provider found for extension:", extension);
        this.tokens = [];
        return;
      }

      // Fetch tokens using language provider
      this.tokens = await languageProvider.getTokens(content);

      // Check if aborted after async operation
      if (signal.aborted) return;

      console.log("[SyntaxHighlighter] Fetched tokens:", this.tokens.length, "for", extension);

      // Cache tokens in buffer store
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.actions.getActiveBuffer();
      if (activeBuffer) {
        bufferStore.actions.updateBufferTokens(activeBuffer.id, this.tokens);
        console.log("[SyntaxHighlighter] Updated buffer tokens for", activeBuffer.path);
      }

      // Update decorations - pass affected lines to avoid full re-render
      this.applyDecorations(affectedLines);
    } catch (error) {
      if (signal.aborted) {
        console.log("[SyntaxHighlighter] Token fetch aborted");
        return;
      }
      console.error("Syntax highlighting error:", error);
      this.tokens = [];
    } finally {
      if (this.abortController?.signal === signal) {
        this.abortController = null;
      }
    }
  }

  private applyDecorations(affectedLines?: Set<number>) {
    // Tokens are stored in buffer-store and automatically
    // converted to line tokens by editor-view-store.
    // This method is called to trigger a re-render when tokens change.
    // The actual decoration rendering happens in the LineRenderer component.

    // Log for debugging
    if (affectedLines && affectedLines.size > 0) {
      console.log("[SyntaxHighlighter] Applied decorations for lines:", Array.from(affectedLines));
    }

    // The buffer store update already triggers the necessary re-renders
    // through Zustand's subscription system, so no additional work needed here.
  }

  dispose() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
    }
    if (this.abortController) {
      this.abortController.abort();
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
