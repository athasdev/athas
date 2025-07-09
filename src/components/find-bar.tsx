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
    <div className="flex items-center gap-2 px-4 py-2 bg-[var(--secondary-bg)] border-b border-[var(--border-color)] text-sm">
      <div className="flex items-center gap-2 flex-1">
        <Search size={14} className="text-[var(--text-lighter)]" />
        <input
          ref={inputRef}
          type="text"
          value={searchQuery}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Find in file..."
          className="flex-1 bg-[var(--primary-bg)] text-[var(--text-color)] border border-[var(--border-color)] rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
        />

        {searchQuery && (
          <div className="flex items-center gap-1 text-xs text-[var(--text-lighter)] font-mono">
            <span>{totalMatches > 0 ? `${currentMatch}/${totalMatches}` : "0/0"}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => onSearch(searchQuery, "previous", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "p-1 rounded hover:bg-[var(--hover-color)] transition-colors duration-150",
            (!searchQuery || totalMatches === 0) && "opacity-50 cursor-not-allowed",
          )}
          title="Previous match (Shift+Enter)"
        >
          <ChevronUp size={14} className="text-[var(--text-lighter)]" />
        </button>
        <button
          onClick={() => onSearch(searchQuery, "next", true)}
          disabled={!searchQuery || totalMatches === 0}
          className={cn(
            "p-1 rounded hover:bg-[var(--hover-color)] transition-colors duration-150",
            (!searchQuery || totalMatches === 0) && "opacity-50 cursor-not-allowed",
          )}
          title="Next match (Enter)"
        >
          <ChevronDown size={14} className="text-[var(--text-lighter)]" />
        </button>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-[var(--hover-color)] transition-colors duration-150 ml-1"
          title="Close (Escape)"
        >
          <X size={14} className="text-[var(--text-lighter)]" />
        </button>
      </div>
    </div>
  );
};

export default FindBar;
