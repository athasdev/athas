import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import { cn } from "../utils/cn";

interface FindBarProps {
  isVisible: boolean;
  onClose: () => void;
  onSearch: (query: string, direction: "next" | "previous", shouldFocus?: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  currentMatch: number;
  totalMatches: number;
}

const FindBar = ({
  isVisible,
  onClose,
  onSearch,
  searchQuery,
  onSearchQueryChange,
  currentMatch,
  totalMatches,
}: FindBarProps) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when find bar becomes visible
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isVisible]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        onSearch(searchQuery, "previous", true);
      } else {
        onSearch(searchQuery, "next", true);
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
      onSearch(value, "next");
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 border-border border-b bg-secondary-bg px-2 py-1.5">
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
        />

        {searchQuery && (
          <div className="flex items-center gap-1 font-mono text-text-lighter text-xs">
            <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onSearch(searchQuery, "previous", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={12} />
        </button>
        <button
          onClick={() => onSearch(searchQuery, "next", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Next match (Enter)"
        >
          <ChevronDown size={12} />
        </button>
        <button
          onClick={onClose}
          className="flex h-5 w-5 items-center justify-center rounded p-0 text-text-lighter transition-colors hover:bg-hover hover:text-text"
          title="Close (Escape)"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
};

export default FindBar;
