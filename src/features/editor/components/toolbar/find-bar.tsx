import {
  CaseSensitive,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Regex,
  Replace,
  Search,
  WholeWord,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useUIState } from "@/stores/ui-state-store";
import { cn } from "@/utils/cn";

const FindBar = () => {
  // Get data from stores
  const { isFindVisible, setIsFindVisible } = useUIState();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const replaceQuery = useEditorUIStore.use.replaceQuery();
  const isReplaceVisible = useEditorUIStore.use.isReplaceVisible();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const {
    setSearchQuery,
    searchNext,
    searchPrevious,
    setReplaceQuery,
    setIsReplaceVisible,
    setSearchOption,
    replaceNext,
    replaceAll,
  } = useEditorUIStore.use.actions();

  const isVisible = isFindVisible;
  const onClose = () => setIsFindVisible(false);
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
  const replaceInputRef = useRef<HTMLInputElement>(null);

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
    setSearchQuery(value);
  };

  const handleReplaceInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setReplaceQuery(e.target.value);
  };

  const handleReplaceKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        replaceAll();
      } else {
        replaceNext();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="find-bar flex flex-col border-border border-b bg-secondary-bg">
      {/* Find row */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* Toggle replace visibility */}
        <button
          onClick={() => setIsReplaceVisible(!isReplaceVisible)}
          className="flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          title={isReplaceVisible ? "Hide replace" : "Show replace"}
          aria-label={isReplaceVisible ? "Hide replace" : "Show replace"}
        >
          <ChevronRight
            size={12}
            className={cn("transition-transform", isReplaceVisible && "rotate-90")}
          />
        </button>

        <div className="flex flex-1 items-center gap-2">
          <Search size={12} className="text-text-lighter" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Find in file..."
            className="ui-font flex-1 border-none bg-transparent text-text text-xs focus:outline-none focus:ring-0"
            style={{ outline: "none", boxShadow: "none" }}
            aria-label="Search query"
          />

          {searchQuery && (
            <div className="ui-font flex items-center gap-1 text-text-lighter text-xs">
              <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
            </div>
          )}
        </div>

        {/* Search options */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => setSearchOption("caseSensitive", !searchOptions.caseSensitive)}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 transition-colors hover:bg-hover",
              searchOptions.caseSensitive
                ? "bg-selected text-text"
                : "text-text-lighter hover:text-text",
            )}
            title="Match case"
            aria-label="Match case"
            aria-pressed={searchOptions.caseSensitive}
          >
            <CaseSensitive size={12} />
          </button>
          <button
            onClick={() => setSearchOption("wholeWord", !searchOptions.wholeWord)}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 transition-colors hover:bg-hover",
              searchOptions.wholeWord
                ? "bg-selected text-text"
                : "text-text-lighter hover:text-text",
            )}
            title="Match whole word"
            aria-label="Match whole word"
            aria-pressed={searchOptions.wholeWord}
          >
            <WholeWord size={12} />
          </button>
          <button
            onClick={() => setSearchOption("useRegex", !searchOptions.useRegex)}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 transition-colors hover:bg-hover",
              searchOptions.useRegex
                ? "bg-selected text-text"
                : "text-text-lighter hover:text-text",
            )}
            title="Use regular expression"
            aria-label="Use regular expression"
            aria-pressed={searchOptions.useRegex}
          >
            <Regex size={12} />
          </button>
        </div>

        {/* Navigation */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onSearch("previous")}
            disabled={!searchQuery || totalMatches === 0}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
              (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
            )}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
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
            aria-label="Next match"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Close (Escape)"
            aria-label="Close find bar"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Replace row */}
      {isReplaceVisible && (
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* Spacer to align with find row */}
          <div className="h-5 w-5" />

          <div className="flex flex-1 items-center gap-2">
            <Replace size={12} className="text-text-lighter" />
            <input
              ref={replaceInputRef}
              type="text"
              value={replaceQuery}
              onChange={handleReplaceInputChange}
              onKeyDown={handleReplaceKeyDown}
              placeholder="Replace with..."
              className="ui-font flex-1 border-none bg-transparent text-text text-xs focus:outline-none focus:ring-0"
              style={{ outline: "none", boxShadow: "none" }}
              aria-label="Replace text"
            />
          </div>

          {/* Replace actions */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={replaceNext}
              disabled={!searchQuery || totalMatches === 0}
              className={cn(
                "ui-font flex h-5 items-center justify-center px-2 text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text",
                (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
              )}
              title="Replace (Enter)"
              aria-label="Replace current match"
            >
              Replace
            </button>
            <button
              onClick={replaceAll}
              disabled={!searchQuery || totalMatches === 0}
              className={cn(
                "ui-font flex h-5 items-center justify-center px-2 text-text-lighter text-xs transition-colors hover:bg-hover hover:text-text",
                (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
              )}
              title="Replace all (Shift+Enter)"
              aria-label="Replace all matches"
            >
              All
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default FindBar;
