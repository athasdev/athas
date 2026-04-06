import type React from "react";
import { useEffect, useRef, useState } from "react";
import { SEARCH_TOGGLE_ICONS, SearchPopover } from "@/ui/search";

export interface TerminalSearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

interface TerminalSearchProps {
  onSearch: (term: string, options: TerminalSearchOptions) => void;
  onNext: (term: string, options: TerminalSearchOptions) => void;
  onPrevious: (term: string, options: TerminalSearchOptions) => void;
  onClose: () => void;
  isVisible: boolean;
  currentMatch: number;
  totalMatches: number;
}

export const TerminalSearch: React.FC<TerminalSearchProps> = ({
  onSearch,
  onNext,
  onPrevious,
  onClose,
  isVisible,
  currentMatch,
  totalMatches,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOptions, setSearchOptions] = useState<TerminalSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isVisible]);

  const handleNext = () => {
    if (searchTerm) {
      onNext(searchTerm, searchOptions);
    }
  };

  const handlePrevious = () => {
    if (searchTerm) {
      onPrevious(searchTerm, searchOptions);
    }
  };

  const toggleOption = (key: keyof TerminalSearchOptions) => {
    setSearchOptions((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (searchTerm) {
        onSearch(searchTerm, next);
      }
      return next;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        handlePrevious();
      } else {
        handleNext();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isVisible) return null;

  return (
    <div className="absolute top-2 right-2 z-30">
      <SearchPopover
        value={searchTerm}
        onChange={(term) => {
          setSearchTerm(term);
          onSearch(term, searchOptions);
        }}
        onKeyDown={handleKeyDown}
        onClose={onClose}
        placeholder="Find in terminal..."
        inputRef={inputRef}
        matchLabel={
          searchTerm ? (totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0") : null
        }
        onNext={handleNext}
        onPrevious={handlePrevious}
        canNavigate={Boolean(searchTerm) && totalMatches > 0}
        options={[
          {
            id: "case-sensitive",
            label: "Match case",
            icon: SEARCH_TOGGLE_ICONS.caseSensitive,
            active: searchOptions.caseSensitive,
            onToggle: () => toggleOption("caseSensitive"),
          },
          {
            id: "whole-word",
            label: "Match whole word",
            icon: SEARCH_TOGGLE_ICONS.wholeWord,
            active: searchOptions.wholeWord,
            onToggle: () => toggleOption("wholeWord"),
          },
          {
            id: "regex",
            label: "Use regular expression",
            icon: SEARCH_TOGGLE_ICONS.regex,
            active: searchOptions.regex,
            onToggle: () => toggleOption("regex"),
          },
        ]}
      />
    </div>
  );
};
