import type React from "react";
import { useEffect, useRef } from "react";
import { useVimSearchStore } from "@/stores/vim-search";
import { useVimStore } from "@/stores/vim-store";

export const VimSearchBar: React.FC = () => {
  const isSearchMode = useVimSearchStore.use.isSearchMode();
  const searchTerm = useVimSearchStore.use.searchTerm();
  const matches = useVimSearchStore.use.matches();
  const currentMatchIndex = useVimSearchStore.use.currentMatchIndex();

  const { updateSearchTerm, executeSearch, exitSearch } = useVimSearchStore.use.actions();
  const { setMode } = useVimStore.use.actions();

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when search mode is activated
  useEffect(() => {
    if (isSearchMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSearchMode]);

  if (!isSearchMode) {
    return null;
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation(); // Prevent vim keyboard handler from processing

    switch (e.key) {
      case "Enter":
        executeSearch();
        setMode("normal");
        break;
      case "Escape":
        exitSearch();
        setMode("normal");
        break;
      default:
        // Let normal input handling continue
        break;
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateSearchTerm(e.target.value);
  };

  const matchInfo =
    matches.length > 0 && currentMatchIndex >= 0
      ? `${currentMatchIndex + 1}/${matches.length}`
      : matches.length === 0 && searchTerm
        ? "0/0"
        : "";

  return (
    <div className="fixed right-0 bottom-0 left-0 z-50 border-border border-t bg-background p-2">
      <div className="mx-auto flex max-w-4xl items-center gap-2">
        <span className="font-mono text-foreground">/</span>
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className="flex-1 border-none bg-transparent font-mono text-foreground outline-none"
          placeholder="Search..."
          autoComplete="off"
        />
        {matchInfo && <span className="font-mono text-muted-foreground text-sm">{matchInfo}</span>}
      </div>
    </div>
  );
};
