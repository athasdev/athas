import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { extensionRegistry } from "@/extensions/registry/extension-registry";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { expandSnippet } from "@/features/editor/snippets/snippet-expander";
import { logger } from "@/features/editor/utils/logger";
import { detectCompletionContext, extractPrefix, filterCompletions } from "@/utils/fuzzy-matcher";
import { createSelectors } from "@/utils/zustand-selectors";
import { useEditorUIStore } from "../stores/ui-store";

// Performance optimizations
const COMPLETION_DEBOUNCE_MS = EDITOR_CONSTANTS.COMPLETION_DEBOUNCE_MS;
const COMPLETION_CACHE_TTL_MS = EDITOR_CONSTANTS.COMPLETION_CACHE_TTL_MS;
const MAX_CACHE_SIZE = EDITOR_CONSTANTS.MAX_COMPLETION_CACHE_SIZE;
const COMPLETION_HIDE_DELAY_MS = 200; // Stability period before hiding to prevent flicker

/**
 * Get snippet completions for a file
 */
function getSnippetCompletions(filePath: string, prefix: string): CompletionItem[] {
  const languageId = extensionRegistry.getLanguageId(filePath);
  if (!languageId) return [];

  const snippets = extensionRegistry.getSnippetsForLanguage(languageId);

  // Filter by prefix if provided
  const matchingSnippets = prefix
    ? snippets.filter((snippet) => snippet.prefix.toLowerCase().startsWith(prefix.toLowerCase()))
    : snippets;

  // Convert to LSP CompletionItem format
  return matchingSnippets.map((snippet) => ({
    label: snippet.prefix,
    kind: 15, // CompletionItemKind.Snippet
    detail: snippet.description || "Snippet",
    insertText: Array.isArray(snippet.body) ? snippet.body.join("\n") : snippet.body,
    insertTextFormat: 2, // InsertTextFormat.Snippet
    sortText: `0_${snippet.prefix}`, // Sort snippets before other completions
    data: {
      isSnippet: true,
      snippet,
    },
  }));
}

// Cache interfaces
interface CacheEntry {
  completions: CompletionItem[];
  timestamp: number;
  prefix: string;
}

interface CompletionCache {
  [key: string]: CacheEntry;
}

// LSP Status types
export type LspStatus = "disconnected" | "connecting" | "connected" | "error";

interface LspStatusInfo {
  status: LspStatus;
  activeWorkspaces: string[];
  lastError?: string;
  supportedLanguages?: string[];
}

interface LspState {
  // Completion handlers
  getCompletions?: (filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
  isLanguageSupported?: (filePath: string) => boolean;

  // Request tracking
  currentCompletionRequest: AbortController | null;
  debounceTimer: NodeJS.Timeout | null;
  hideCompletionTimer: NodeJS.Timeout | null;

  // Cache
  completionCache: CompletionCache;

  // Status tracking
  lspStatus: LspStatusInfo;

  // Actions
  actions: LspActions;
}

interface LspActions {
  setCompletionHandlers: (
    getCompletions?: (
      filePath: string,
      line: number,
      character: number,
    ) => Promise<CompletionItem[]>,
    isLanguageSupported?: (filePath: string) => boolean,
  ) => void;

  requestCompletion: (params: {
    filePath: string;
    cursorPos: number;
    value: string;
    editorRef: React.RefObject<HTMLDivElement | null>;
  }) => Promise<void>;

  performCompletionRequest: (params: {
    filePath: string;
    cursorPos: number;
    value: string;
    editorRef: React.RefObject<HTMLDivElement | null>;
  }) => Promise<void>;

  getCacheKey: (filePath: string, line: number, character: number) => string;
  cleanExpiredCache: () => void;
  limitCacheSize: () => void;

  // Completion visibility helpers to prevent flickering
  scheduleHideCompletion: () => void;
  cancelHideCompletion: () => void;

  applyCompletion: (params: { completion: CompletionItem; value: string; cursorPos: number }) => {
    newValue: string;
    newCursorPos: number;
  };

  // LSP Status actions
  updateLspStatus: (status: LspStatus, workspaces?: string[], error?: string) => void;
  setLspError: (error: string) => void;
  clearLspError: () => void;
}

export const useLspStore = createSelectors(
  create<LspState>()((set, get) => ({
    getCompletions: undefined,
    isLanguageSupported: undefined,
    currentCompletionRequest: null,
    debounceTimer: null,
    hideCompletionTimer: null,
    completionCache: {},
    lspStatus: {
      status: "disconnected" as LspStatus,
      activeWorkspaces: [],
      lastError: undefined,
      supportedLanguages: undefined,
    },

    actions: {
      setCompletionHandlers: (getCompletions, isLanguageSupported) => {
        set({ getCompletions, isLanguageSupported });
      },

      // Cache management helpers
      getCacheKey: (filePath: string, line: number, character: number) => {
        return `${filePath}:${line}:${character}`;
      },

      cleanExpiredCache: () => {
        const { completionCache } = get();
        const now = Date.now();
        const cleanedCache: CompletionCache = {};

        for (const [key, entry] of Object.entries(completionCache)) {
          if (now - entry.timestamp < COMPLETION_CACHE_TTL_MS) {
            cleanedCache[key] = entry;
          }
        }

        set({ completionCache: cleanedCache });
      },

      limitCacheSize: () => {
        const { completionCache } = get();
        const entries = Object.entries(completionCache);

        if (entries.length > MAX_CACHE_SIZE) {
          // Sort by timestamp and keep newest entries
          entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
          const limitedCache: CompletionCache = {};

          entries.slice(0, MAX_CACHE_SIZE).forEach(([key, entry]) => {
            limitedCache[key] = entry;
          });

          set({ completionCache: limitedCache });
        }
      },

      // Schedule hiding completion dropdown with delay to prevent flicker
      scheduleHideCompletion: () => {
        const { hideCompletionTimer } = get();
        const completionActions = useEditorUIStore.getState().actions;

        // Clear any existing timer
        if (hideCompletionTimer) {
          clearTimeout(hideCompletionTimer);
        }

        // Schedule hide after delay
        const newTimer = setTimeout(() => {
          completionActions.setIsLspCompletionVisible(false);
          set({ hideCompletionTimer: null });
        }, COMPLETION_HIDE_DELAY_MS);

        set({ hideCompletionTimer: newTimer });
      },

      // Cancel scheduled hide (when showing completions)
      cancelHideCompletion: () => {
        const { hideCompletionTimer } = get();

        if (hideCompletionTimer) {
          clearTimeout(hideCompletionTimer);
          set({ hideCompletionTimer: null });
        }
      },

      requestCompletion: async ({ filePath, cursorPos, value, editorRef }) => {
        const { debounceTimer, actions } = get();

        // Clear existing debounce timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        // Debounce completion requests
        const timer = setTimeout(async () => {
          try {
            await actions.performCompletionRequest({ filePath, cursorPos, value, editorRef });
          } catch (error) {
            logger.error("Editor", "Debounced completion request failed:", error);
          }
        }, COMPLETION_DEBOUNCE_MS);

        set({ debounceTimer: timer });
      },

      performCompletionRequest: async ({ filePath, cursorPos, value, editorRef }) => {
        const {
          getCompletions,
          isLanguageSupported,
          currentCompletionRequest,
          completionCache,
          actions,
        } = get();
        const { actions: completionActions } = useEditorUIStore.getState();

        // Early returns BEFORE aborting to avoid unnecessary cancellations
        if (
          !getCompletions ||
          !filePath ||
          !isLanguageSupported?.(filePath) ||
          filePath.startsWith("remote://") ||
          !editorRef.current
        ) {
          return;
        }

        completionActions.setIsApplyingCompletion(false);

        // Extract the current prefix being typed
        const prefix = extractPrefix(value, cursorPos);
        completionActions.setCurrentPrefix(prefix);

        // Smart triggering: check context before requesting completions
        const currentChar = cursorPos > 0 ? value[cursorPos - 1] : "";

        // Only skip if we just typed whitespace - use delayed hide to prevent flicker
        if (/\s/.test(currentChar)) {
          actions.scheduleHideCompletion();
          return;
        }

        const lines = value.substring(0, cursorPos).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;

        // Check cache first
        const cacheKey = actions.getCacheKey(filePath, line, character);
        const cachedEntry = completionCache[cacheKey];

        if (cachedEntry && Date.now() - cachedEntry.timestamp < COMPLETION_CACHE_TTL_MS) {
          // Use cached completions and merge with snippets
          const lspCompletions = cachedEntry.completions;
          const snippetCompletions = getSnippetCompletions(filePath, prefix);
          const completions = [...snippetCompletions, ...lspCompletions];

          if (completions.length > 0) {
            completionActions.setLspCompletions(completions);

            if (prefix.length > 0) {
              const context = detectCompletionContext(value, cursorPos);
              const filtered = await filterCompletions({
                pattern: prefix,
                completions,
                context_word: prefix,
                context_type: context,
              });

              if (filtered.length > 0) {
                actions.cancelHideCompletion(); // Cancel any pending hide
                completionActions.setFilteredCompletions(filtered);
                completionActions.setIsLspCompletionVisible(true);
                completionActions.setSelectedLspIndex(0);
              } else {
                actions.scheduleHideCompletion(); // Delayed hide to prevent flicker
              }
            } else {
              actions.scheduleHideCompletion(); // Delayed hide to prevent flicker
            }
          }
          return;
        }

        // Cancel any existing request only when we're about to make a new one
        if (currentCompletionRequest) {
          currentCompletionRequest.abort();
          set({ currentCompletionRequest: null });
        }

        // Create new abort controller for this request
        const abortController = new AbortController();
        set({ currentCompletionRequest: abortController });

        try {
          const startTime = performance.now();
          const lspCompletions = await getCompletions(filePath, line, character);

          // Check if request was cancelled
          if (abortController.signal.aborted) {
            return;
          }

          const _elapsed = performance.now() - startTime;

          // Get snippet completions and merge with LSP completions
          const snippetCompletions = getSnippetCompletions(filePath, prefix);
          const completions = [...snippetCompletions, ...lspCompletions];

          if (completions.length > 0) {
            // Cache the results (cache LSP completions separately)
            const { completionCache: currentCache } = get();
            const newCache = {
              ...currentCache,
              [cacheKey]: {
                completions: lspCompletions,
                timestamp: Date.now(),
                prefix,
              },
            };
            set({ completionCache: newCache });

            // Clean cache periodically
            actions.cleanExpiredCache();
            actions.limitCacheSize();

            // Store original completions (merged)
            completionActions.setLspCompletions(completions);

            // Filter completions using fuzzy matching if we have a prefix
            if (prefix.length > 0) {
              const context = detectCompletionContext(value, cursorPos);
              const filtered = await filterCompletions({
                pattern: prefix,
                completions,
                context_word: prefix,
                context_type: context,
              });

              if (filtered.length > 0) {
                actions.cancelHideCompletion(); // Cancel any pending hide
                completionActions.setFilteredCompletions(filtered);
                completionActions.setIsLspCompletionVisible(true);
                completionActions.setSelectedLspIndex(0);
              } else {
                actions.scheduleHideCompletion(); // Delayed hide to prevent flicker
              }
            } else {
              actions.scheduleHideCompletion(); // Delayed hide to prevent flicker
            }
          } else {
            // Hide completion UI if no completions - use delayed hide
            actions.scheduleHideCompletion();
          }
        } catch (error) {
          // Ignore if request was aborted
          if (error instanceof Error && error.name !== "AbortError") {
            logger.error("Editor", "LSP completion error:", error);
          }
        } finally {
          // Clear the request reference
          if (get().currentCompletionRequest === abortController) {
            set({ currentCompletionRequest: null });
          }
        }
      },

      applyCompletion: ({ completion, value, cursorPos }) => {
        const { actions: completionActions } = useEditorUIStore.getState();

        completionActions.setIsApplyingCompletion(true);
        completionActions.setIsLspCompletionVisible(false);

        // Calculate word boundaries
        const before = value.substring(0, cursorPos);
        const after = value.substring(cursorPos);
        const wordMatch = before.match(/\w*$/);
        const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
        const prefixLength = wordMatch ? wordMatch[0].length : 0;

        // Check if this is a snippet completion
        if (completion.data?.isSnippet && completion.insertTextFormat === 2) {
          try {
            const snippet = completion.data.snippet;
            if (!snippet) {
              // Fallback to regular insertion
              const insertText = completion.insertText || completion.label;
              return {
                newValue: value.substring(0, wordStart) + insertText + after,
                newCursorPos: wordStart + insertText.length,
              };
            }

            // Calculate position for snippet expansion
            const lines = value.substring(0, cursorPos).split("\n");
            const line = lines.length - 1;
            const column = lines[lines.length - 1].length;

            // Expand the snippet with variables resolved
            const session = expandSnippet(
              { body: snippet.body, prefix: snippet.prefix },
              { line, column, offset: cursorPos },
              { fileName: "", filePath: "" },
            );

            const expandedBody = session.parsedSnippet.expandedBody;
            const newValue = value.substring(0, cursorPos - prefixLength) + expandedBody + after;

            // Position cursor at end of expanded snippet (or first tab stop if handling that)
            const newCursorPos = cursorPos - prefixLength + expandedBody.length;

            logger.info("LSP", `Expanded snippet: ${snippet.prefix}`);

            return { newValue, newCursorPos };
          } catch (error) {
            logger.error("LSP", "Failed to expand snippet:", error);
            // Fallback to regular insertion
          }
        }

        // Regular completion (non-snippet)
        const insertText = completion.insertText || completion.label;
        const newValue = value.substring(0, wordStart) + insertText + after;
        const newCursorPos = wordStart + insertText.length;

        return { newValue, newCursorPos };
      },

      // LSP Status actions
      updateLspStatus: (status, workspaces, error) => {
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            status,
            activeWorkspaces: workspaces || state.lspStatus.activeWorkspaces,
            lastError: error || (status === "error" ? state.lspStatus.lastError : undefined),
          },
        }));
      },

      setLspError: (error) => {
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            status: "error" as LspStatus,
            lastError: error,
          },
        }));
      },

      clearLspError: () => {
        set((state) => ({
          lspStatus: {
            ...state.lspStatus,
            lastError: undefined,
            status: state.lspStatus.activeWorkspaces.length > 0 ? "connected" : "disconnected",
          },
        }));
      },
    },
  })),
);
