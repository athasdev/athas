import { useEffect, useRef } from "react";
import { useAuthStore } from "@/features/window/stores/auth-store";
import {
  AutocompleteError,
  requestAutocomplete,
} from "@/features/editor/services/editor-autocomplete-service";

interface UseAutocompleteOptions {
  enabled: boolean;
  provider: "openrouter" | "custom";
  model: string;
  customBaseUrl: string;
  filePath: string | null;
  languageId: string | null;
  content: string;
  cursorOffset: number;
  lastInputTimestamp: number;
  hasActiveFolds: boolean;
  setAutocompleteCompletion: (completion: { text: string; cursorOffset: number } | null) => void;
}

const DEBOUNCE_MS = 300;
const BEFORE_CURSOR_CONTEXT = 3500;
const AFTER_CURSOR_CONTEXT = 1200;
const COMPLETION_OVERLAP_SCAN_LIMIT = 256;

const WORD_LIKE_TRIGGER_REGEX = /[\w\]})>"'`.]/;
const CONTEXT_FOLLOWUP_TRIGGER_REGEX = /[\w\]})>"'`.{;=:[\],(]/;

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r";
}

function getPreviousNonWhitespaceChar(content: string, startIndex: number): string {
  for (let i = startIndex; i >= 0; i--) {
    const char = content[i];
    if (!isWhitespace(char)) {
      return char;
    }
  }
  return "";
}

function findLeadingOverlapLength(beforeCursor: string, completion: string): number {
  const max = Math.min(beforeCursor.length, completion.length, COMPLETION_OVERLAP_SCAN_LIMIT);
  for (let length = max; length > 0; length--) {
    if (beforeCursor.slice(-length) === completion.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function findTrailingOverlapLength(completion: string, afterCursor: string): number {
  const max = Math.min(completion.length, afterCursor.length, COMPLETION_OVERLAP_SCAN_LIMIT);
  for (let length = max; length > 0; length--) {
    if (completion.slice(-length) === afterCursor.slice(0, length)) {
      return length;
    }
  }
  return 0;
}

function normalizeCompletionText(raw: string, beforeCursor: string, afterCursor: string): string {
  let normalized = raw.replace(/\r\n/g, "\n");
  if (!normalized) return "";

  const leadingOverlap = findLeadingOverlapLength(beforeCursor, normalized);
  if (leadingOverlap > 0) {
    normalized = normalized.slice(leadingOverlap);
  }

  if (!normalized) return "";

  const trailingOverlap = findTrailingOverlapLength(normalized, afterCursor);
  if (trailingOverlap > 0) {
    normalized = normalized.slice(0, -trailingOverlap);
  }

  return normalized;
}

function shouldTriggerForCharacter(content: string, cursorOffset: number): boolean {
  const charBeforeCursor = content[cursorOffset - 1] || "";

  if (WORD_LIKE_TRIGGER_REGEX.test(charBeforeCursor)) {
    return true;
  }

  // Trigger after whitespace/newline when the previous meaningful token suggests continuation.
  // Example: "div {" + Enter should request a block body suggestion.
  if (isWhitespace(charBeforeCursor)) {
    const previousSignificantChar = getPreviousNonWhitespaceChar(content, cursorOffset - 2);
    return CONTEXT_FOLLOWUP_TRIGGER_REGEX.test(previousSignificantChar);
  }

  return false;
}

export function useAutocomplete({
  enabled,
  provider,
  model,
  customBaseUrl,
  filePath,
  languageId,
  content,
  cursorOffset,
  lastInputTimestamp,
  hasActiveFolds,
  setAutocompleteCompletion,
}: UseAutocompleteOptions) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);

  const requestIdRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previousInputTimestampRef = useRef<number>(0);

  const subscriptionStatus = subscription?.status ?? "free";
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const isPro = subscriptionStatus === "pro";
  const useByok = managedPolicy ? managedPolicy.allowByok && !isPro : !isPro;
  const needsAthasAuth = provider !== "custom";

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    abortControllerRef.current?.abort();

    const didUserType = lastInputTimestamp !== previousInputTimestampRef.current;
    previousInputTimestampRef.current = lastInputTimestamp;

    if (
      !enabled ||
      (needsAthasAuth && !isAuthenticated) ||
      (managedPolicy ? !managedPolicy.aiCompletionEnabled : false) ||
      !model.trim() ||
      (provider === "custom" && !customBaseUrl.trim()) ||
      hasActiveFolds ||
      lastInputTimestamp === 0 ||
      cursorOffset <= 0
    ) {
      setAutocompleteCompletion(null);
      return;
    }

    // Do not fetch new suggestions for pure cursor navigation events.
    if (!didUserType) {
      setAutocompleteCompletion(null);
      return;
    }

    if (!shouldTriggerForCharacter(content, cursorOffset)) {
      setAutocompleteCompletion(null);
      return;
    }

    const requestId = ++requestIdRef.current;

    timerRef.current = setTimeout(async () => {
      const beforeCursor = content.slice(
        Math.max(0, cursorOffset - BEFORE_CURSOR_CONTEXT),
        cursorOffset,
      );
      const afterCursor = content.slice(cursorOffset, cursorOffset + AFTER_CURSOR_CONTEXT);

      if (!beforeCursor.trim()) {
        setAutocompleteCompletion(null);
        return;
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const result = await requestAutocomplete(
          {
            model,
            beforeCursor,
            afterCursor,
            filePath: filePath || undefined,
            languageId: languageId || undefined,
          },
          {
            useByok: provider === "custom" ? false : useByok,
            provider,
            customBaseUrl,
            onChunk: (partialCompletion) => {
              if (abortController.signal.aborted || requestIdRef.current !== requestId) {
                return;
              }

              const normalizedText = normalizeCompletionText(
                partialCompletion,
                beforeCursor,
                afterCursor,
              );
              if (!normalizedText) return;

              setAutocompleteCompletion({ text: normalizedText, cursorOffset });
            },
          },
        );

        if (abortController.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }

        const text = result.completion;
        if (!text) {
          setAutocompleteCompletion(null);
          return;
        }

        const normalizedText = normalizeCompletionText(text, beforeCursor, afterCursor);
        if (!normalizedText) {
          setAutocompleteCompletion(null);
          return;
        }

        setAutocompleteCompletion({ text: normalizedText, cursorOffset });
      } catch (error) {
        if (abortController.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }

        if (
          error instanceof AutocompleteError &&
          (error.status === 401 || error.status === 402 || error.status === 403)
        ) {
          setAutocompleteCompletion(null);
          return;
        }

        console.error("Autocomplete failed:", error);
        setAutocompleteCompletion(null);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    enabled,
    provider,
    needsAthasAuth,
    isAuthenticated,
    managedPolicy,
    useByok,
    filePath,
    hasActiveFolds,
    lastInputTimestamp,
    cursorOffset,
    content,
    model,
    customBaseUrl,
    languageId,
    setAutocompleteCompletion,
  ]);
}

export const __test__ = {
  findLeadingOverlapLength,
  findTrailingOverlapLength,
  normalizeCompletionText,
  shouldTriggerForCharacter,
};
