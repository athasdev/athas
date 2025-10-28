import type { Token } from "../lib/rust-api/tokens";
import { getTokens as getTokensByExtension } from "../lib/rust-api/tokens";
import { useBufferStore } from "../stores/buffer-store";
import type { Change } from "../types/editor-types";
import { extensionManager } from "./extension-manager";
import type { EditorAPI, EditorExtension } from "./extension-types";

const DEBOUNCE_TIME_MS = 16; // ~1 frame at 60fps for near-instant highlighting

class SyntaxHighlighter {
  private tokens: Token[] = [];
  private timeoutId: NodeJS.Timeout | null = null;
  private rafId: number | null = null;
  private filePath: string | null = null;
  private pendingAffectedLines: Set<number> | undefined = undefined;
  private abortController: AbortController | null = null;

  constructor(_editor: EditorAPI) {}

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
    // Capture the file path at the start of the fetch to avoid race conditions
    const targetFilePath = this.filePath;

    try {
      // Get content for the specific target file path to avoid races
      const bufferStoreAtStart = useBufferStore.getState();
      const targetBufferAtStart = bufferStoreAtStart.buffers.find((b) => b.path === targetFilePath);
      if (!targetBufferAtStart) {
        console.warn(
          "[SyntaxHighlighter] No buffer found for path at fetch start:",
          targetFilePath,
        );
        return;
      }
      const content = targetBufferAtStart.content;
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

      // Prefer direct tokenization by actual file extension to avoid
      // mismatches (e.g., jsx/tsx falling back to js/ts providers)
      try {
        this.tokens = await getTokensByExtension(content, extension);
      } catch (_e) {
        // Fallback to language provider if direct tokenization fails
        const languageProvider = extensionManager.getLanguageProvider(extension);
        if (!languageProvider) {
          console.warn("[SyntaxHighlighter] No language provider found for extension:", extension);
          this.tokens = [];
        } else {
          this.tokens = await languageProvider.getTokens(content);
        }
      }

      // Check if aborted after async operation
      if (signal.aborted) return;

      console.log("[SyntaxHighlighter] Fetched tokens:", this.tokens.length, "for", extension);

      // Cache tokens in buffer store for the correct buffer by file path
      const bufferStore = useBufferStore.getState();
      const targetBuffer = bufferStore.buffers.find((b) => b.path === targetFilePath);
      if (targetBuffer) {
        bufferStore.actions.updateBufferTokens(targetBuffer.id, this.tokens);
        console.log("[SyntaxHighlighter] Updated buffer tokens for", targetBuffer.path);
      } else {
        console.warn("[SyntaxHighlighter] Target buffer not found for path:", targetFilePath);
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
