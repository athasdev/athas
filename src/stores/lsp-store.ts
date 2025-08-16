import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { detectCompletionContext, extractPrefix, filterCompletions } from "@/utils/fuzzy-matcher";
import { createSelectors } from "@/utils/zustand-selectors";
import { useEditorCompletionStore } from "./editor-completion-store";

// Performance optimizations
const COMPLETION_DEBOUNCE_MS = 150;
const COMPLETION_CACHE_TTL_MS = 5000;
const MAX_CACHE_SIZE = 100;

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
            console.error("Debounced completion request failed:", error);
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
        const { actions: completionActions } = useEditorCompletionStore.getState();

        // Cancel any existing request
        if (currentCompletionRequest) {
          currentCompletionRequest.abort();
        }

        if (
          !getCompletions ||
          !filePath ||
          !isLanguageSupported?.(filePath) ||
          filePath.startsWith("remote://") ||
          !editorRef.current
        ) {
          return;
        }

        // Extract the current prefix being typed
        const prefix = extractPrefix(value, cursorPos);
        completionActions.setCurrentPrefix(prefix);

        // Smart triggering: check context before requesting completions
        const currentChar = cursorPos > 0 ? value[cursorPos - 1] : "";

        // Only skip if we just typed whitespace
        if (/\s/.test(currentChar)) {
          completionActions.setIsLspCompletionVisible(false);
          return;
        }

        const lines = value.substring(0, cursorPos).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;

        // Check cache first
        const cacheKey = actions.getCacheKey(filePath, line, character);
        const cachedEntry = completionCache[cacheKey];

        if (cachedEntry && Date.now() - cachedEntry.timestamp < COMPLETION_CACHE_TTL_MS) {
          // Use cached completions if they match the current prefix or are compatible
          const completions = cachedEntry.completions;

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
                completionActions.setFilteredCompletions(filtered);
                completionActions.setIsLspCompletionVisible(true);
                completionActions.setSelectedLspIndex(0);
              } else {
                completionActions.setIsLspCompletionVisible(false);
              }
            } else {
              completionActions.setIsLspCompletionVisible(false);
            }
          }
          return;
        }

        // Create new abort controller for this request
        const abortController = new AbortController();
        set({ currentCompletionRequest: abortController });

        try {
          const startTime = performance.now();
          const completions = await getCompletions(filePath, line, character);

          // Check if request was cancelled
          if (abortController.signal.aborted) {
            return;
          }

          const _elapsed = performance.now() - startTime;

          if (completions.length > 0) {
            // Cache the results
            const { completionCache: currentCache } = get();
            const newCache = {
              ...currentCache,
              [cacheKey]: {
                completions,
                timestamp: Date.now(),
                prefix,
              },
            };
            set({ completionCache: newCache });

            // Clean cache periodically
            actions.cleanExpiredCache();
            actions.limitCacheSize();

            // Store original completions
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
                completionActions.setFilteredCompletions(filtered);
                completionActions.setIsLspCompletionVisible(true);
                completionActions.setSelectedLspIndex(0);
              } else {
                completionActions.setIsLspCompletionVisible(false);
              }
            } else {
              completionActions.setIsLspCompletionVisible(false);
            }
          } else {
            // Hide completion UI if no completions
            completionActions.setIsLspCompletionVisible(false);
          }
        } catch (error) {
          // Ignore if request was aborted
          if (error instanceof Error && error.name !== "AbortError") {
            console.error("LSP completion error:", error);
          }
        } finally {
          // Clear the request reference
          if (get().currentCompletionRequest === abortController) {
            set({ currentCompletionRequest: null });
          }
        }
      },

      applyCompletion: ({ completion, value, cursorPos }) => {
        const { actions: completionActions } = useEditorCompletionStore.getState();

        const before = value.substring(0, cursorPos);
        const after = value.substring(cursorPos);
        const wordMatch = before.match(/\w*$/);
        const wordStart = wordMatch ? cursorPos - wordMatch[0].length : cursorPos;
        const insertText = completion.insertText || completion.label;
        const newValue = value.substring(0, wordStart) + insertText + after;
        const newCursorPos = wordStart + insertText.length;

        completionActions.setIsLspCompletionVisible(false);

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
