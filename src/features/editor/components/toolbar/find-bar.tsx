import type React from "react";
import { useEffect, useRef } from "react";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import {
  SEARCH_TOGGLE_ICONS,
  SearchPopover,
  SearchReplaceRow,
  SearchReplaceToggle,
} from "@/ui/search-popover";

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
    <div className="pointer-events-none absolute top-9 right-2 z-30">
      <div className="pointer-events-auto">
        <SearchPopover
          value={searchQuery}
          onChange={setSearchQuery}
          onKeyDown={handleKeyDown}
          onClose={onClose}
          placeholder="Find in file..."
          inputRef={inputRef}
          matchLabel={
            searchQuery ? (totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0") : null
          }
          onNext={() => onSearch("next")}
          onPrevious={() => onSearch("previous")}
          canNavigate={Boolean(searchQuery) && totalMatches > 0}
          leadingControl={
            <SearchReplaceToggle
              isExpanded={isReplaceVisible}
              onToggle={() => setIsReplaceVisible(!isReplaceVisible)}
            />
          }
          options={[
            {
              id: "case-sensitive",
              label: "Match case",
              icon: SEARCH_TOGGLE_ICONS.caseSensitive,
              active: searchOptions.caseSensitive,
              onToggle: () => setSearchOption("caseSensitive", !searchOptions.caseSensitive),
            },
            {
              id: "whole-word",
              label: "Match whole word",
              icon: SEARCH_TOGGLE_ICONS.wholeWord,
              active: searchOptions.wholeWord,
              onToggle: () => setSearchOption("wholeWord", !searchOptions.wholeWord),
            },
            {
              id: "regex",
              label: "Use regular expression",
              icon: SEARCH_TOGGLE_ICONS.regex,
              active: searchOptions.useRegex,
              onToggle: () => setSearchOption("useRegex", !searchOptions.useRegex),
            },
          ]}
          secondaryRow={
            isReplaceVisible ? (
              <SearchReplaceRow
                value={replaceQuery}
                onChange={setReplaceQuery}
                onKeyDown={handleReplaceKeyDown}
                inputRef={replaceInputRef}
                onReplace={replaceNext}
                onReplaceAll={replaceAll}
                canReplace={Boolean(searchQuery) && totalMatches > 0}
              />
            ) : null
          }
        />
      </div>
    </div>
  );
};

export default FindBar;
