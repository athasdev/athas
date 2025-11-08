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
}

export const TerminalSearch: React.FC<TerminalSearchProps> = ({
  onSearch,
  onNext,
  onPrevious,
  onClose,
  isVisible,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [currentMatch, setCurrentMatch] = useState(0);
  const [totalMatches, _setTotalMatches] = useState(0);
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
      setCurrentMatch((prev) => (prev < totalMatches ? prev + 1 : prev));
    }
  };

  const handlePrevious = () => {
    if (searchTerm) {
      onPrevious(searchTerm);
      setCurrentMatch((prev) => (prev > 1 ? prev - 1 : prev));
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
    <div className="absolute top-2 right-12 z-50 flex items-center gap-2 rounded-md border border-border bg-secondary-bg p-2 shadow-lg">
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={handleSearchChange}
        onKeyDown={handleKeyDown}
        placeholder="Find in terminal..."
        className={cn(
          "w-48 bg-transparent px-2 py-1 text-sm",
          "border-none outline-none focus:outline-none",
          "placeholder:text-text-lighter",
        )}
      />

      {searchTerm && totalMatches > 0 && (
        <span className="text-text-light text-xs">
          {currentMatch}/{totalMatches}
        </span>
      )}

      <button
        onClick={handlePrevious}
        disabled={!searchTerm || totalMatches === 0}
        className={cn(
          "rounded p-1 transition-colors hover:bg-hover",
          (!searchTerm || totalMatches === 0) && "cursor-not-allowed opacity-50",
        )}
        title="Previous match (Shift+Enter)"
      >
        <ChevronUp className="h-3 w-3" />
      </button>

      <button
        onClick={handleNext}
        disabled={!searchTerm || totalMatches === 0}
        className={cn(
          "rounded p-1 transition-colors hover:bg-hover",
          (!searchTerm || totalMatches === 0) && "cursor-not-allowed opacity-50",
        )}
        title="Next match (Enter)"
      >
        <ChevronDown className="h-3 w-3" />
      </button>

      <button
        onClick={onClose}
        className="rounded p-1 transition-colors hover:bg-hover"
        title="Close (Esc)"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};
