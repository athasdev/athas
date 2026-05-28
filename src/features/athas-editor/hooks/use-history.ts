import { useCallback, useEffect, useRef } from "react";
import type { HistoryEntry } from "@/features/editor/history/types";
import { useHistoryStore } from "@/features/editor/stores/history-store";
import type { Position, Range } from "@/features/editor/types/editor";

const HISTORY_DEBOUNCE_MS = 500;

interface UseHistoryOptions {
  bufferId: string;
  enabled?: boolean;
}

export function useHistory({ bufferId, enabled = true }: UseHistoryOptions) {
  const { pushHistory } = useHistoryStore.use.actions();
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastContentRef = useRef<string>("");
  const lastCursorRef = useRef<Position | null>(null);
  const lastSelectionRef = useRef<Range | null>(null);

  const saveToHistory = useCallback(
    (content: string, cursorPosition: Position, selection?: Range) => {
      // Don't save if content hasn't changed
      if (content === lastContentRef.current) {
        return;
      }

      // Clear any pending debounce
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      // Debounce the history push
      debounceTimerRef.current = setTimeout(() => {
        const entry: HistoryEntry = {
          content: lastContentRef.current,
          cursorPosition: lastCursorRef.current || cursorPosition,
          selection: lastSelectionRef.current || selection,
          timestamp: Date.now(),
        };

        pushHistory(bufferId, entry);

        // Update refs
        lastContentRef.current = content;
        lastCursorRef.current = cursorPosition;
        lastSelectionRef.current = selection || null;
      }, HISTORY_DEBOUNCE_MS);
    },
    [bufferId, pushHistory],
  );

  const trackChange = useCallback(
    (content: string, cursorPosition: Position, selection?: Range) => {
      if (!enabled) return;

      // Update current state immediately
      lastCursorRef.current = cursorPosition;
      lastSelectionRef.current = selection || null;

      // Save to history with debouncing
      saveToHistory(content, cursorPosition, selection);
    },
    [enabled, saveToHistory],
  );

  const flushHistory = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      flushHistory();
    };
  }, [flushHistory]);

  return {
    trackChange,
    flushHistory,
  };
}
