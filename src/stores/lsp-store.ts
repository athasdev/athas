import type { CompletionItem } from "vscode-languageserver-protocol";
import { create } from "zustand";
import { detectCompletionContext, extractPrefix, filterCompletions } from "@/utils/fuzzy-matcher";
import { createSelectors } from "@/utils/zustand-selectors";
import { useEditorCompletionStore } from "./editor-completion-store";

interface LspState {
  // Completion handlers
  getCompletions?: (filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
  isLanguageSupported?: (filePath: string) => boolean;

  // Request tracking
  currentCompletionRequest: AbortController | null;

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

  applyCompletion: (params: { completion: CompletionItem; value: string; cursorPos: number }) => {
    newValue: string;
    newCursorPos: number;
  };
}

export const useLspStore = createSelectors(
  create<LspState>()((set, get) => ({
    getCompletions: undefined,
    isLanguageSupported: undefined,
    currentCompletionRequest: null,

    actions: {
      setCompletionHandlers: (getCompletions, isLanguageSupported) => {
        set({ getCompletions, isLanguageSupported });
      },

      requestCompletion: async ({ filePath, cursorPos, value, editorRef }) => {
        const { getCompletions, isLanguageSupported, currentCompletionRequest } = get();
        const { actions: completionActions } = useEditorCompletionStore.getState();

        console.log("LSP requestCompletion", { filePath, cursorPos });

        // Cancel any existing request
        if (currentCompletionRequest) {
          console.log("Cancelling previous completion request");
          currentCompletionRequest.abort();
        }

        if (
          !getCompletions ||
          !filePath ||
          !isLanguageSupported?.(filePath) ||
          filePath.startsWith("remote://") ||
          !editorRef.current
        ) {
          console.log("Skipping completion:", {
            hasGetCompletions: !!getCompletions,
            hasFilePath: !!filePath,
            isSupported: isLanguageSupported?.(filePath),
            isRemote: filePath?.startsWith("remote://"),
            hasEditor: !!editorRef.current,
          });
          return;
        }

        // Extract the current prefix being typed
        const prefix = extractPrefix(value, cursorPos);
        console.log("Current prefix:", prefix);
        completionActions.setCurrentPrefix(prefix);

        // Smart triggering: check context before requesting completions
        const currentChar = cursorPos > 0 ? value[cursorPos - 1] : "";

        // Only skip if we just typed whitespace
        if (/\s/.test(currentChar)) {
          console.log("Skipping completion: whitespace");
          completionActions.setIsLspCompletionVisible(false);
          return;
        }

        const lines = value.substring(0, cursorPos).split("\n");
        const line = lines.length - 1;
        const character = lines[lines.length - 1].length;

        // No need to calculate position here anymore - the dropdown component handles it

        // Create new abort controller for this request
        const abortController = new AbortController();
        set({ currentCompletionRequest: abortController });

        try {
          console.log(`Requesting completions at ${line}:${character}`);
          const startTime = performance.now();
          const completions = await getCompletions(filePath, line, character);

          // Check if request was cancelled
          if (abortController.signal.aborted) {
            console.log("Completion request was cancelled");
            return;
          }

          const elapsed = performance.now() - startTime;
          console.log(`Received ${completions.length} completions in ${elapsed.toFixed(2)}ms`);

          if (completions.length > 0) {
            // Log completion results for debugging
            console.log(
              "Completions received:",
              completions.map((c) => ({
                label: c.label,
                kind: c.kind,
                detail: c.detail,
              })),
            );

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

              console.log(`Filtered ${completions.length} to ${filtered.length} completions`);

              if (filtered.length > 0) {
                completionActions.setFilteredCompletions(filtered);
                completionActions.setIsLspCompletionVisible(true);
                completionActions.setSelectedLspIndex(0);
              } else {
                completionActions.setIsLspCompletionVisible(false);
              }
            } else {
              // No prefix - don't show completions when file is just opened
              completionActions.setIsLspCompletionVisible(false);
            }
          } else {
            // Hide completion UI if no completions
            completionActions.setIsLspCompletionVisible(false);
          }
        } catch (error) {
          // Ignore if request was aborted
          if (error instanceof Error && error.name === "AbortError") {
            console.log("Completion request aborted");
          } else {
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
    },
  })),
);
