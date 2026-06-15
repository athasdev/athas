import { useEffect, useRef } from "react";
import { useAuthStore } from "@/features/window/stores/auth.store";
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
  hasActiveFolds: boolean;
  getLastInputTimestamp?: () => number;
  subscribeToInputTimestamp?: (listener: (timestamp: number) => void) => () => void;
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
  hasActiveFolds,
  getLastInputTimestamp,
  subscribeToInputTimestamp,
  setAutocompleteCompletion,
}: UseAutocompleteOptions) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const subscription = useAuthStore((state) => state.subscription);

  const subscriptionStatus = subscription?.status ?? "free";
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const isPro = subscriptionStatus === "pro";
  const useByok = managedPolicy ? managedPolicy.allowByok && !isPro : !isPro;
  const needsAthasAuth = provider !== "custom";

  const requestIdRef = useRef(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const previousInputTimestampRef = useRef<number>(getLastInputTimestamp?.() ?? 0);
  const latestContentRef = useRef(content);
  const latestOptionsRef = useRef({
    enabled,
    provider,
    model,
    customBaseUrl,
    filePath,
    languageId,
    cursorOffset,
    hasActiveFolds,
    isAuthenticated,
    managedPolicy,
    useByok: false,
    needsAthasAuth: false,
    setAutocompleteCompletion,
  });

  latestContentRef.current = content;
  latestOptionsRef.current = {
    enabled,
    provider,
    model,
    customBaseUrl,
    filePath,
    languageId,
    cursorOffset,
    hasActiveFolds,
    isAuthenticated,
    managedPolicy,
    useByok,
    needsAthasAuth,
    setAutocompleteCompletion,
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      abortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setAutocompleteCompletion(null);
  }, [cursorOffset, setAutocompleteCompletion]);

  useEffect(() => {
    const clearPendingRequest = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();
    };

    const isRequestBlocked = () => {
      const options = latestOptionsRef.current;
      return (
        !options.enabled ||
        (options.needsAthasAuth && !options.isAuthenticated) ||
        (options.managedPolicy ? !options.managedPolicy.aiCompletionEnabled : false) ||
        !options.model.trim() ||
        (options.provider === "custom" && !options.customBaseUrl.trim()) ||
        options.hasActiveFolds ||
        options.cursorOffset <= 0
      );
    };

    if (isRequestBlocked()) {
      clearPendingRequest();
      setAutocompleteCompletion(null);
    }
  }, [
    enabled,
    provider,
    isAuthenticated,
    managedPolicy,
    hasActiveFolds,
    cursorOffset,
    model,
    customBaseUrl,
    languageId,
    setAutocompleteCompletion,
  ]);

  useEffect(() => {
    if (!subscribeToInputTimestamp) return;

    const unsubscribe = subscribeToInputTimestamp((lastInputTimestamp) => {
      if (lastInputTimestamp === 0 || lastInputTimestamp === previousInputTimestampRef.current) {
        return;
      }

      previousInputTimestampRef.current = lastInputTimestamp;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();

      const requestId = ++requestIdRef.current;

      timerRef.current = setTimeout(async () => {
        const requestOptions = latestOptionsRef.current;
        const requestContent = latestContentRef.current;

        if (
          !requestOptions.enabled ||
          (requestOptions.needsAthasAuth && !requestOptions.isAuthenticated) ||
          (requestOptions.managedPolicy
            ? !requestOptions.managedPolicy.aiCompletionEnabled
            : false) ||
          !requestOptions.model.trim() ||
          (requestOptions.provider === "custom" && !requestOptions.customBaseUrl.trim()) ||
          requestOptions.hasActiveFolds ||
          requestOptions.cursorOffset <= 0
        ) {
          requestOptions.setAutocompleteCompletion(null);
          return;
        }

        if (!shouldTriggerForCharacter(requestContent, requestOptions.cursorOffset)) {
          requestOptions.setAutocompleteCompletion(null);
          return;
        }

        const beforeCursor = requestContent.slice(
          Math.max(0, requestOptions.cursorOffset - BEFORE_CURSOR_CONTEXT),
          requestOptions.cursorOffset,
        );
        const afterCursor = requestContent.slice(
          requestOptions.cursorOffset,
          requestOptions.cursorOffset + AFTER_CURSOR_CONTEXT,
        );

        if (!beforeCursor.trim()) {
          requestOptions.setAutocompleteCompletion(null);
          return;
        }

        const abortController = new AbortController();
        abortControllerRef.current = abortController;

        try {
          const result = await requestAutocomplete(
            {
              model: requestOptions.model,
              beforeCursor,
              afterCursor,
              filePath: requestOptions.filePath || undefined,
              languageId: requestOptions.languageId || undefined,
            },
            {
              useByok: requestOptions.provider === "custom" ? false : requestOptions.useByok,
              provider: requestOptions.provider,
              customBaseUrl: requestOptions.customBaseUrl,
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

                requestOptions.setAutocompleteCompletion({
                  text: normalizedText,
                  cursorOffset: requestOptions.cursorOffset,
                });
              },
            },
          );

          if (abortController.signal.aborted || requestIdRef.current !== requestId) {
            return;
          }

          const text = result.completion;
          if (!text) {
            requestOptions.setAutocompleteCompletion(null);
            return;
          }

          const normalizedText = normalizeCompletionText(text, beforeCursor, afterCursor);
          if (!normalizedText) {
            requestOptions.setAutocompleteCompletion(null);
            return;
          }

          requestOptions.setAutocompleteCompletion({
            text: normalizedText,
            cursorOffset: requestOptions.cursorOffset,
          });
        } catch (error) {
          if (abortController.signal.aborted || requestIdRef.current !== requestId) {
            return;
          }

          if (
            error instanceof AutocompleteError &&
            (error.status === 401 || error.status === 402 || error.status === 403)
          ) {
            requestOptions.setAutocompleteCompletion(null);
            return;
          }

          console.error("Autocomplete failed:", error);
          requestOptions.setAutocompleteCompletion(null);
        }
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      abortControllerRef.current?.abort();
    };
  }, [subscribeToInputTimestamp]);
}

export const __test__ = {
  findLeadingOverlapLength,
  findTrailingOverlapLength,
  normalizeCompletionText,
  shouldTriggerForCharacter,
};
