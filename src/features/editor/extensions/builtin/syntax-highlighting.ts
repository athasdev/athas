import { wasmParserLoader } from "../../lib/wasm-parser";
import { useBufferStore } from "../../stores/buffer-store";
import type { Change } from "../../types/editor";
import { logger } from "../../utils/logger";
import { extensionManager } from "../manager";
import type { EditorAPI, EditorExtension, Token } from "../types";

const DEBOUNCE_TIME_MS = 150; // Debounce for tokenization requests

class SyntaxHighlighter {
  private tokens: Token[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private filePath: string | null = null;
  private pendingAffectedLines: Set<number> | undefined = undefined;
  private abortController: AbortController | null = null;
  private contentVersion = 0; // Track content version to prevent stale tokens

  // biome-ignore lint/complexity/noUselessConstructor: Required for API contract
  constructor(_editor: EditorAPI) {}

  setFilePath(filePath: string) {
    this.filePath = filePath;
    this.contentVersion++; // Increment version on file switch
    // When switching files, try to use cached tokens immediately
    this.updateHighlighting(true);
  }

  async updateHighlighting(immediate = false, affectedLines?: Set<number>) {
    if (!this.filePath) {
      return;
    }

    // Increment version on content change to invalidate pending fetches
    this.contentVersion++;

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

        // Debounce tokenization
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

      // Debounce tokenization
      this.timeoutId = setTimeout(async () => {
        const linesToUpdate = this.pendingAffectedLines;
        this.pendingAffectedLines = undefined;
        await this.fetchAndCacheTokens(linesToUpdate);
      }, DEBOUNCE_TIME_MS);
    }
  }

  private async fetchAndCacheTokens(affectedLines?: Set<number>) {
    // Check if WASM is initialized (graceful degradation)
    if (!wasmParserLoader.isInitialized()) {
      logger.debug("SyntaxHighlighter", "WASM not initialized yet, scheduling retry");
      // Schedule retry after WASM loads
      setTimeout(() => {
        if (this.filePath) {
          // Only retry if we still have a file path (not disposed)
          this.fetchAndCacheTokens(affectedLines);
        }
      }, 100);
      return;
    }

    // Create new abort controller for this fetch
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    // Capture the file path and content version at the start to avoid race conditions
    const targetFilePath = this.filePath;
    const expectedVersion = this.contentVersion;

    try {
      // Get content for the specific target file path to avoid races
      const bufferStoreAtStart = useBufferStore.getState();
      const targetBufferAtStart = bufferStoreAtStart.buffers.find((b) => b.path === targetFilePath);
      if (!targetBufferAtStart) {
        logger.warn(
          "SyntaxHighlighter",
          "No buffer found for path at fetch start:",
          targetFilePath,
        );
        return;
      }
      const content = targetBufferAtStart.content;
      const contentHash = content.length; // Simple hash, could use better hashing
      const rawExt = (targetFilePath?.split(".").pop() || "txt").toLowerCase();
      const normalizeExt = (ext: string) => {
        switch (ext) {
          case "mjs":
          case "cjs":
            return "js";
          case "yml":
            return "yaml";
          case "htm":
            return "html";
          case "jsonc":
            return "json";
          case "mdx":
            return "markdown";
          default:
            return ext;
        }
      };
      const extension = normalizeExt(rawExt);

      // Check if aborted before proceeding
      if (signal.aborted) return;

      // Ensure language provider is loaded (lazy loading)
      const languageProvider = await extensionManager.ensureLanguageProvider(extension);
      if (!languageProvider) {
        logger.debug(
          "SyntaxHighlighter",
          "No language provider available for extension:",
          extension,
        );
        this.tokens = [];
      } else {
        try {
          this.tokens = await languageProvider.getTokens(content);
        } catch (error) {
          logger.error("SyntaxHighlighter", `Failed to tokenize with ${extension}:`, error);
          this.tokens = [];
        }
      }

      // Check if aborted after async operation
      if (signal.aborted) return;

      // Verify content hasn't changed (prevent stale tokens)
      if (this.contentVersion !== expectedVersion) {
        logger.debug(
          "SyntaxHighlighter",
          "Content version mismatch, discarding stale tokens",
          expectedVersion,
          "vs",
          this.contentVersion,
        );
        return;
      }

      // Verify content hash matches (additional safety check)
      const bufferStore = useBufferStore.getState();
      const targetBuffer = bufferStore.buffers.find((b) => b.path === targetFilePath);
      if (!targetBuffer) {
        logger.warn("SyntaxHighlighter", "Target buffer not found for path:", targetFilePath);
        return;
      }

      if (targetBuffer.content.length !== contentHash) {
        logger.debug("SyntaxHighlighter", "Content changed during tokenization, discarding tokens");
        return;
      }

      logger.debug("SyntaxHighlighter", "Fetched tokens:", this.tokens.length, "for", extension);

      // Cache tokens in buffer store
      bufferStore.actions.updateBufferTokens(targetBuffer.id, this.tokens);
      logger.debug("SyntaxHighlighter", "Updated buffer tokens for", targetBuffer.path);

      // Update decorations - pass affected lines to avoid full re-render
      this.applyDecorations(affectedLines);
    } catch (error) {
      if (signal.aborted) {
        logger.debug("SyntaxHighlighter", "Token fetch aborted");
        return;
      }
      logger.error("SyntaxHighlighter", "Syntax highlighting error:", error);
      this.tokens = [];
      // Clear buffer tokens on error
      const bufferStore = useBufferStore.getState();
      const targetBuffer = bufferStore.buffers.find((b) => b.path === targetFilePath);
      if (targetBuffer) {
        bufferStore.actions.updateBufferTokens(targetBuffer.id, []);
      }
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
      logger.debug(
        "SyntaxHighlighter",
        "Applied decorations for lines:",
        Array.from(affectedLines),
      );
    }

    // The buffer store update already triggers the necessary re-renders
    // through Zustand's subscription system, so no additional work needed here.
  }

  dispose() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }
    if (this.abortController) {
      this.abortController.abort();
    }
  }
}

let highlighter: SyntaxHighlighter | null = null;
let lastKnownFilePath: string | null = null;

export const syntaxHighlightingExtension: EditorExtension = {
  name: "Syntax Highlighting",
  version: "1.0.0",
  description: "Provides syntax highlighting for various programming languages",

  initialize: (editor: EditorAPI) => {
    highlighter = new SyntaxHighlighter(editor);
    // If a file path was set before the extension initialized, use it now
    if (lastKnownFilePath) {
      highlighter.setFilePath(lastKnownFilePath);
      // Force immediate highlight on init
      highlighter.updateHighlighting(true);
    } else {
      highlighter.updateHighlighting();
    }
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
  lastKnownFilePath = filePath;
  if (highlighter) {
    highlighter.setFilePath(filePath);
    highlighter.updateHighlighting(true);
  }
}
