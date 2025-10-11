import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { useEditorSearchStore } from "../stores/editor-search-store";
import { useUIState } from "../stores/ui-state-store";
import { cn } from "../utils/cn";

const FindBar = () => {
  // Get data from stores
  const { isFindVisible, setIsFindVisible } = useUIState();
  const searchQuery = useEditorSearchStore.use.searchQuery();
  const searchMatches = useEditorSearchStore.use.searchMatches();
  const currentMatchIndex = useEditorSearchStore.use.currentMatchIndex();
  const { setSearchQuery, searchNext, searchPrevious } = useEditorSearchStore.use.actions();

  const isVisible = isFindVisible;
  const onClose = () => setIsFindVisible(false);
  const onSearchQueryChange = setSearchQuery;
  const currentMatch = currentMatchIndex + 1;
  const totalMatches = searchMatches.length;
  const onSearch = (direction: "next" | "previous") => {
    if (direction === "next") {
      searchNext();
    } else {
      searchPrevious();
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when find bar becomes visible
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isVisible]);

  // Global Cmd+F handler to toggle find bar even when input is focused
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener("keydown", handleGlobalKeyDown);
      return () => {
        document.removeEventListener("keydown", handleGlobalKeyDown);
      };
    }
  }, [isVisible, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onSearch("previous");
      } else {
        onSearch("next");
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    onSearchQueryChange(value);
    if (value.trim()) {
      onSearch("next");
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="find-bar flex items-center gap-2 border-border border-b bg-secondary-bg px-2 py-1.5">
      <div className="flex flex-1 items-center gap-2">
        <Search size={12} className="text-text-lighter" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Find in file..."
          className="flex-1 border-none bg-transparent font-mono text-text text-xs focus:outline-none focus:ring-0"
          style={{ outline: "none", boxShadow: "none" }}
        />

        {searchQuery && (
          <div className="flex items-center gap-1 font-mono text-text-lighter text-xs">
            <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onSearch("previous")}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={() => onSearch("next")}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Next match (Enter)"
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={onClose}
          className={cn(
            "flex h-5 w-5 items-center justify-center p-0",
            "text-text-lighter transition-colors hover:bg-hover hover:text-text",
          )}
          title="Close (Escape)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

export default FindBar;
