import type React from "react";
import { useCallback, useState } from "react";
import type { CodeEditorRef } from "../components/code-editor";
import type { SearchState } from "../types/app";
import type { Buffer } from "../types/buffer";

interface UseSearchProps {
  activeBuffer: Buffer | null;
  codeEditorRef: React.RefObject<CodeEditorRef | null>;
}

export const useSearch = ({ activeBuffer, codeEditorRef }: UseSearchProps) => {
  const [searchState, setSearchState] = useState<SearchState>({
    query: "",
    currentMatch: 0,
    totalMatches: 0,
    matches: [],
  });
  const [isFindVisible, setIsFindVisible] = useState<boolean>(false);

  const performSearch = useCallback(
    (query: string, direction: "next" | "previous", shouldFocus: boolean = false) => {
      if (!activeBuffer || !query.trim()) {
        setSearchState({
          query,
          currentMatch: 0,
          totalMatches: 0,
          matches: [],
        });
        return;
      }

      const content = activeBuffer.content;
      const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      const matches = Array.from(content.matchAll(regex));

      // Calculate all match positions for highlighting
      const matchPositions = matches.map(match => ({
        start: match.index!,
        end: match.index! + match[0].length,
      }));

      if (matches.length === 0) {
        setSearchState({
          query,
          currentMatch: 0,
          totalMatches: 0,
          matches: matchPositions,
        });
        return;
      }

      const textarea = codeEditorRef.current?.textarea;
      if (!textarea) return;

      const currentPos = textarea.selectionStart;
      let targetMatch = 0;

      if (direction === "next") {
        // Find the next match after current cursor position
        targetMatch = matches.findIndex(match => match.index! > currentPos);
        if (targetMatch === -1) {
          targetMatch = 0; // Wrap to first match
        }
      } else {
        // Find the previous match before current cursor position
        targetMatch =
          matches
            .map((match, idx) => ({ match, idx }))
            .filter(({ match }) => match.index! < currentPos)
            .pop()?.idx ?? matches.length - 1; // Wrap to last match
      }

      const match = matches[targetMatch];
      if (match && match.index !== undefined) {
        textarea.setSelectionRange(match.index, match.index + match[0].length);
        // Only focus the textarea when explicitly navigating, not when typing
        if (shouldFocus) {
          textarea.focus();
        }
        setSearchState({
          query,
          currentMatch: targetMatch + 1,
          totalMatches: matches.length,
          matches: matchPositions,
        });
      }
    },
    [activeBuffer, codeEditorRef],
  );

  const handleSearchQueryChange = useCallback(
    (query: string) => {
      if (query.trim()) {
        performSearch(query, "next", false); // Don't focus when typing
      } else {
        setSearchState({
          query,
          currentMatch: 0,
          totalMatches: 0,
          matches: [],
        });
      }
    },
    [performSearch],
  );

  const handleFindClose = useCallback(() => {
    setIsFindVisible(false);
    setSearchState({
      query: "",
      currentMatch: 0,
      totalMatches: 0,
      matches: [],
    });
    // Return focus to editor
    const textarea = codeEditorRef.current?.textarea;
    if (textarea) {
      textarea.focus();
    }
  }, [codeEditorRef]);

  return {
    searchState,
    isFindVisible,
    setIsFindVisible,
    performSearch,
    handleSearchQueryChange,
    handleFindClose,
  };
};
