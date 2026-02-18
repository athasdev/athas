import { useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { AutocompleteError, requestAutocomplete } from "@/utils/autocomplete";

interface UseAutocompleteOptions {
  enabled: boolean;
  model: string;
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
const DEBUG_AUTOCOMPLETE = import.meta.env.DEV;

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (!DEBUG_AUTOCOMPLETE) return;
  if (payload) {
    console.log(`[Autocomplete] ${message}`, payload);
    return;
  }
  console.log(`[Autocomplete] ${message}`);
}

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
  model,
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
  const isPro = subscriptionStatus === "pro" || subscriptionStatus === "trial";
  const useByok = !isPro;

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
      !isAuthenticated ||
      hasActiveFolds ||
      lastInputTimestamp === 0 ||
      cursorOffset <= 0
    ) {
      if (didUserType) {
        debugLog("skip-prereq", {
          enabled,
          isAuthenticated,
          subscriptionStatus,
          hasActiveFolds,
          lastInputTimestamp,
          cursorOffset,
        });
      }
      setAutocompleteCompletion(null);
      return;
    }

    // Do not fetch new suggestions for pure cursor navigation events.
    if (!didUserType) {
      setAutocompleteCompletion(null);
      return;
    }

    if (!shouldTriggerForCharacter(content, cursorOffset)) {
      const previousSignificantChar = getPreviousNonWhitespaceChar(content, cursorOffset - 2);
      debugLog("skip-trigger-char", {
        charBeforeCursor: content[cursorOffset - 1] || "",
        previousChar: content[cursorOffset - 2] || "",
        previousSignificantChar,
      });
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
        debugLog("request", {
          model,
          filePath: filePath || "untitled",
          languageId: languageId || "unknown",
          cursorOffset,
        });

        const result = await requestAutocomplete(
          {
            model,
            beforeCursor,
            afterCursor,
            filePath: filePath || undefined,
            languageId: languageId || undefined,
          },
          { useByok },
        );

        if (abortController.signal.aborted || requestIdRef.current !== requestId) {
          return;
        }

        const text = result.completion;
        if (!text) {
          debugLog("empty-completion");
          setAutocompleteCompletion(null);
          return;
        }

        const normalizedText = normalizeCompletionText(text, beforeCursor, afterCursor);
        if (!normalizedText) {
          debugLog("empty-normalized-completion");
          setAutocompleteCompletion(null);
          return;
        }

        debugLog("suggestion-ready", {
          rawLength: text.length,
          normalizedLength: normalizedText.length,
        });
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
    isAuthenticated,
    useByok,
    subscriptionStatus,
    filePath,
    hasActiveFolds,
    lastInputTimestamp,
    cursorOffset,
    content,
    model,
    languageId,
    setAutocompleteCompletion,
  ]);
}
