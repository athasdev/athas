import { CaseSensitive, ChevronDown, ChevronUp, Regex, Search, WholeWord, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";

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

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value;
    setSearchTerm(term);
    onSearch(term, searchOptions);
  };

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
    <div className="border-border border-b bg-secondary-bg">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex flex-1 items-center gap-2">
          <Search size={12} className="text-text-lighter" />
          <Input
            ref={inputRef}
            type="text"
            value={searchTerm}
            onChange={handleSearchChange}
            onKeyDown={handleKeyDown}
            placeholder="Find in terminal..."
            variant="ghost"
            className="ui-font flex-1 px-0 text-xs"
            style={{ outline: "none", boxShadow: "none" }}
          />

          {searchTerm && (
            <div className="ui-font flex items-center gap-1 text-text-lighter text-xs">
              <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => toggleOption("caseSensitive")}
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
            type="button"
            onClick={() => toggleOption("wholeWord")}
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
            type="button"
            onClick={() => toggleOption("regex")}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 transition-colors hover:bg-hover",
              searchOptions.regex ? "bg-selected text-text" : "text-text-lighter hover:text-text",
            )}
            title="Use regular expression"
            aria-label="Use regular expression"
            aria-pressed={searchOptions.regex}
          >
            <Regex size={12} />
          </button>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={handlePrevious}
            disabled={!searchTerm || totalMatches === 0}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
              (!searchTerm || totalMatches === 0) && "cursor-not-allowed opacity-50",
            )}
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!searchTerm || totalMatches === 0}
            className={cn(
              "flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
              (!searchTerm || totalMatches === 0) && "cursor-not-allowed opacity-50",
            )}
            title="Next match (Enter)"
            aria-label="Next match"
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
            title="Close (Escape)"
            aria-label="Close find bar"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
};
