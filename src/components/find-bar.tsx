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
    <div className="flex items-center gap-2 border-border border-b bg-secondary-bg px-4 py-2 text-sm">
      <div className="flex flex-1 items-center gap-2">
        <Search size={14} className="text-text-lighter" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Find in file..."
          className="flex-1 rounded border border-border bg-primary-bg px-2 py-1 font-mono text-text text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {searchQuery && (
          <div className="flex items-center gap-1 font-mono text-text-lighter text-xs">
            <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onSearch(searchQuery, "previous", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "rounded p-1 transition-colors duration-150 hover:bg-hover",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} className="text-text-lighter" />
        </button>
        <button
          onClick={() => onSearch(searchQuery, "next", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "rounded p-1 transition-colors duration-150 hover:bg-hover",
            (!searchQuery || totalMatches === 0) && "cursor-not-allowed opacity-50",
          )}
          title="Next match (Enter)"
        >
          <ChevronDown size={14} className="text-text-lighter" />
        </button>
        <button
          onClick={onClose}
          className="ml-1 rounded p-1 transition-colors duration-150 hover:bg-hover"
          title="Close (Escape)"
        >
          <X size={14} className="text-text-lighter" />
        </button>
      </div>
    </div>
  );
};

export default FindBar;
