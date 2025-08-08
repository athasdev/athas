import { Search } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import FileIcon from "@/file-explorer/views/file.icon";
import { useFileSystemStore } from "@/file-system/controllers/store";
import type { FileEntry } from "@/file-system/models/app";
import { useAIChatStore } from "@/stores/ai-chat/store";
import { useProjectStore } from "@/stores/project-store";
import { cn } from "@/utils/cn";
import { IGNORED_PATTERNS } from "../command/constants/ignored-patterns";

interface FileMentionDropdownProps {
  onSelect: (file: FileEntry) => void;
}

// Function to check if a file should be ignored (same as command bar)
const shouldIgnoreFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() || "";
  const fullPath = filePath.toLowerCase();

  return IGNORED_PATTERNS.some((pattern) => {
    if (pattern.includes("*")) {
      // Handle glob patterns like *.log
      const regex = new RegExp(pattern.replace(/\*/g, ".*"));
      return regex.test(fileName.toLowerCase()) || regex.test(fullPath);
    } else {
      // Handle exact matches
      return (
        fileName.toLowerCase() === pattern.toLowerCase() ||
        fullPath.includes(`/${pattern.toLowerCase()}/`) ||
        fullPath.endsWith(`/${pattern.toLowerCase()}`)
      );
    }
  });
};

// Fuzzy search scoring function (same as command bar)
const fuzzyScore = (text: string, query: string): number => {
  if (!query) return 0;

  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();

  // Exact match gets highest score
  if (textLower === queryLower) return 1000;

  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 800;

  // Contains query as substring gets medium score
  if (textLower.includes(queryLower)) return 600;

  // Fuzzy matching - check if all query characters exist in order
  let textIndex = 0;
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;

  while (textIndex < textLower.length && queryIndex < queryLower.length) {
    if (textLower[textIndex] === queryLower[queryIndex]) {
      score += 10;
      consecutiveMatches++;
      // Bonus for consecutive matches
      if (consecutiveMatches > 1) {
        score += consecutiveMatches * 2;
      }
      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
    textIndex++;
  }

  // If we matched all query characters, it's a valid fuzzy match
  if (queryIndex === queryLower.length) {
    // Bonus for shorter text (more precise match)
    score += Math.max(0, 100 - textLower.length);
    return score;
  }

  return 0; // No match
};

export const FileMentionDropdown = React.memo(function FileMentionDropdown({
  onSelect,
}: FileMentionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [allProjectFiles, setAllProjectFiles] = useState<
    Array<{ name: string; path: string; isDir: boolean }>
  >([]);

  // Get rootFolderPath from project store and file system store
  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();

  // Get state from store
  const { mentionState, hideMention } = useAIChatStore();
  const { position, selectedIndex } = mentionState;

  // Load all project files on mount (same as command bar)
  useEffect(() => {
    getAllProjectFiles().then((allFiles) => {
      const formattedFiles = allFiles.map((file) => ({
        name: file.name,
        path: file.path,
        isDir: file.isDir,
      }));
      setAllProjectFiles(formattedFiles);
    });
  }, [getAllProjectFiles]);

  // Initialize search term from mention state
  useEffect(() => {
    setSearchTerm(mentionState.search || "");
  }, [mentionState.search]);

  // Get filtered files using fuzzy search (same logic as command bar)
  const filteredFiles = useMemo(() => {
    const availableFiles = allProjectFiles.filter(
      (file) => !file.isDir && !shouldIgnoreFile(file.path),
    );

    if (!searchTerm.trim()) {
      // No search query - show alphabetical list
      return availableFiles.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
    }

    // With search query - use fuzzy search
    const scoredFiles = availableFiles
      .map((file) => {
        // Score both filename and full path, take the higher score
        const nameScore = fuzzyScore(file.name, searchTerm);
        const pathScore = fuzzyScore(file.path, searchTerm);
        const score = Math.max(nameScore, pathScore);

        return { file, score };
      })
      .filter(({ score }) => score > 0) // Only include files with positive scores
      .sort((a, b) => {
        // First sort by score (highest first)
        if (b.score !== a.score) return b.score - a.score;
        // Then sort alphabetically
        return a.file.name.localeCompare(b.file.name);
      })
      .slice(0, 20); // Limit to 20 results

    return scoredFiles.map(({ file }) => file);
  }, [allProjectFiles, searchTerm]);

  // Get relative path for display (same as command bar)
  const getRelativePath = (fullPath: string): string => {
    if (!rootFolderPath) return fullPath;

    const normalizedFullPath = fullPath.replace(/\\/g, "/");
    const normalizedRootPath = rootFolderPath.replace(/\\/g, "/");

    if (normalizedFullPath.startsWith(normalizedRootPath)) {
      const relativePath = normalizedFullPath.substring(normalizedRootPath.length);
      return relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
    }

    return fullPath;
  };

  // Get directory path for display
  const getDirectoryPath = (fullPath: string): string => {
    const relativePath = getRelativePath(fullPath);
    const lastSlashIndex = relativePath.lastIndexOf("/");
    return lastSlashIndex > 0 ? relativePath.substring(0, lastSlashIndex) : "";
  };

  const handleFileClick = (file: { name: string; path: string; isDir: boolean }) => {
    // Convert to FileEntry format and select
    const fileEntry: FileEntry = {
      name: file.name,
      path: file.path,
      isDir: file.isDir,
      expanded: false,
      children: undefined,
    };
    onSelect(fileEntry);
  };

  // Scroll selected item into view
  useEffect(() => {
    const itemsContainer = dropdownRef.current?.querySelector(".items-container");
    const selectedItem = itemsContainer?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  // Adjust position using proper positioning logic like breadcrumb
  const adjustedPosition = useMemo(() => {
    const dropdownWidth = 320;
    const dropdownHeight = Math.min(
      filteredFiles.length * 26 + 60, // Reduced height per item from 32 to 26
      EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
    );
    const padding = 8;

    let { top, left } = position;

    // If the position is negative or too high up, position it below the input instead
    if (top < padding) {
      // Find the textarea and position below it
      const textarea = document.querySelector(
        'textarea[placeholder*="tag files"]',
      ) as HTMLTextAreaElement;
      if (textarea) {
        const textareaRect = textarea.getBoundingClientRect();
        top = textareaRect.bottom + 4; // Position just below the textarea
        left = textareaRect.left; // Align with left edge of textarea
      } else {
        // Fallback positioning
        top = 100;
        left = Math.max(padding, left);
      }
    }

    // Ensure dropdown doesn't go off the right edge of the screen
    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }

    // Ensure dropdown doesn't go off the bottom of the screen
    if (top + dropdownHeight > window.innerHeight - padding) {
      top = Math.max(padding, window.innerHeight - dropdownHeight - padding);
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
    };
  }, [position.top, position.left, filteredFiles.length]);

  // Handle keyboard navigation and outside clicks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        hideMention();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideMention();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [hideMention]);

  if (filteredFiles.length === 0) {
    return null;
  }

  return createPortal(
    <div
      ref={dropdownRef}
      className="scrollbar-hidden fixed select-none overflow-y-auto rounded-md border border-border bg-secondary-bg shadow-lg"
      style={{
        zIndex: EDITOR_CONSTANTS.Z_INDEX.DROPDOWN,
        maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
        width: "320px",
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
      }}
      role="listbox"
      aria-label="File suggestions"
    >
      {/* Search input */}
      <div className="border-border border-b p-2">
        <div className="relative">
          <Search
            size={12}
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2 transform text-text-lighter"
          />
          <input
            type="text"
            placeholder="Search files..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded border border-border bg-primary-bg py-1 pr-2 pl-6 text-text text-xs placeholder-text-lighter focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/50"
            aria-label="Search files"
          />
        </div>
      </div>

      {/* Files list */}
      <div className="items-container py-1" role="listbox" aria-label="File list">
        {filteredFiles.length === 0 ? (
          <div className="px-3 py-2 text-center font-mono text-text-lighter text-xs">
            {searchTerm ? "No matching files found" : "No files available"}
          </div>
        ) : (
          filteredFiles.map((file, index) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1 text-left font-mono text-xs transition-colors",
                "focus:outline-none focus:ring-1 focus:ring-accent/50",
                index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover",
              )}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
            >
              <FileIcon
                fileName={file.name}
                isDir={false}
                isExpanded={false}
                size={10}
                className="flex-shrink-0 text-text-lighter"
              />
              <div className="min-w-0 flex-1 truncate">
                <span className="text-text">{file.name}</span>
                <span className="ml-2 text-[10px] text-text-lighter opacity-60">
                  {getDirectoryPath(file.path) || "root"}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>,
    document.body,
  );
});
