import { ChevronDown, ChevronUp, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/utils/cn";

interface TerminalSearchProps {
  onSearch: (term: string) => void;
  onNext: (term: string) => void;
  onPrevious: (term: string) => void;
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
    if (term) {
      onSearch(term);
    }
  };

  const handleNext = () => {
    if (searchTerm) {
      onNext(searchTerm);
    }
  };

  const handlePrevious = () => {
    if (searchTerm) {
      onPrevious(searchTerm);
    }
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
    <div className="absolute top-1.5 right-10 z-50 flex items-center gap-1 border border-border bg-secondary-bg px-1.5 py-1 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={handleSearchChange}
        onKeyDown={handleKeyDown}
        placeholder="Find..."
        className={cn(
          "ui-font w-32 bg-transparent px-1.5 py-0.5 text-text text-xs",
          "border-none outline-none focus:outline-none",
          "placeholder:text-text-lighter",
        )}
      />

      {searchTerm && totalMatches > 0 && (
        <span className="ui-font whitespace-nowrap text-[10px] text-text-lighter">
          {currentMatch}/{totalMatches}
        </span>
      )}

      <div className="mx-0.5 h-3 w-px bg-border" />

      <button
        type="button"
        onClick={handlePrevious}
        disabled={!searchTerm}
        className={cn(
          "flex items-center justify-center rounded p-0.5 text-text-light transition-colors hover:bg-hover hover:text-text",
          !searchTerm && "cursor-not-allowed opacity-40",
        )}
        title="Previous (Shift+Enter)"
      >
        <ChevronUp size={12} />
      </button>

      <button
        type="button"
        onClick={handleNext}
        disabled={!searchTerm}
        className={cn(
          "flex items-center justify-center rounded p-0.5 text-text-light transition-colors hover:bg-hover hover:text-text",
          !searchTerm && "cursor-not-allowed opacity-40",
        )}
        title="Next (Enter)"
      >
        <ChevronDown size={12} />
      </button>

      <div className="mx-0.5 h-3 w-px bg-border" />

      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center rounded p-0.5 text-text-light transition-colors hover:bg-hover hover:text-text"
        title="Close (Esc)"
      >
        <X size={12} />
      </button>
    </div>
  );
};
