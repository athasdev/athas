import type React from "react";
import { useEffect, useRef } from "react";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorUIStore } from "@/features/editor/stores/ui-store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import {
  SEARCH_TOGGLE_ICONS,
  SearchPopover,
  SearchReplaceRow,
  SearchReplaceToggle,
} from "@/ui/search";

const FindBar = () => {
  // Get data from stores
  const { isFindVisible, setIsFindVisible } = useUIState();
  const searchQuery = useEditorUIStore.use.searchQuery();
  const searchMatches = useEditorUIStore.use.searchMatches();
  const currentMatchIndex = useEditorUIStore.use.currentMatchIndex();
  const replaceQuery = useEditorUIStore.use.replaceQuery();
  const isReplaceVisible = useEditorUIStore.use.isReplaceVisible();
  const searchOptions = useEditorUIStore.use.searchOptions();
  const selection = useEditorStateStore((state) => state.selection);
  const editorValue = useEditorStateStore((state) => state.value);
  const editorRef = useEditorStateStore((state) => state.editorRef);
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
  const onClose = () => {
    setIsFindVisible(false);
    const textarea = editorRef?.current?.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      textarea.focus();
    }
  };
  const currentMatch = currentMatchIndex + 1;
  const totalMatches = searchMatches.length;
  const hasNoResults = Boolean(searchQuery) && totalMatches === 0;
  const onSearch = (direction: "next" | "previous") => {
    if (direction === "next") {
      searchNext();
    } else {
      searchPrevious();
    }
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const wasVisibleRef = useRef(false);

  const getSelectedSearchText = () => {
    if (!selection) return "";

    const startOffset = Math.min(selection.start.offset, selection.end.offset);
    const endOffset = Math.max(selection.start.offset, selection.end.offset);

    if (startOffset === endOffset) return "";

    const selectedText = editorValue.slice(startOffset, endOffset);
    if (!selectedText || selectedText.includes("\n")) return "";

    return selectedText;
  };

  // Focus input when find bar becomes visible
  useEffect(() => {
    if (!isVisible) {
      wasVisibleRef.current = false;
      return;
    }

    if (!wasVisibleRef.current) {
      const selectedText = getSelectedSearchText();
      if (selectedText && selectedText !== searchQuery) {
        setSearchQuery(selectedText);
      }
      wasVisibleRef.current = true;
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }
  }, [isVisible, searchQuery, selection, editorValue, setSearchQuery]);

  // Global find navigation shortcuts while the popover is open
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        onClose();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) {
          searchPrevious();
        } else {
          searchNext();
        }
      }
    };

    if (isVisible) {
      document.addEventListener("keydown", handleGlobalKeyDown);
      return () => {
        document.removeEventListener("keydown", handleGlobalKeyDown);
      };
    }
  }, [isVisible, onClose, searchNext, searchPrevious]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onSearch("previous");
      } else {
        onSearch("next");
      }
    } else if (e.key === "Tab" && isReplaceVisible) {
      e.preventDefault();
      replaceInputRef.current?.focus();
      replaceInputRef.current?.select();
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
    } else if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    } else if (e.key === "Tab") {
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
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
            searchQuery
              ? totalMatches > 0
                ? `${currentMatch}/${totalMatches}`
                : "No results"
              : null
          }
          matchTone={hasNoResults ? "warning" : "default"}
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
