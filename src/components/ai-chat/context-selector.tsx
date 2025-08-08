import { Database, FileText, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FileIcon from "../../file-explorer/views/file.icon";
import { useFileSystemStore } from "../../file-system/controllers/store";
import type { FileEntry } from "../../file-system/models/app";
import { useProjectStore } from "../../stores/project-store";
import { cn } from "../../utils/cn";
import { IGNORED_PATTERNS } from "../command/constants/ignored-patterns";

interface ContextSelectorProps {
  buffers: Array<{
    id: string;
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    isSQLite: boolean;
    isActive: boolean;
  }>;
  allProjectFiles: FileEntry[];
  selectedBufferIds: Set<string>;
  selectedFilesPaths: Set<string>;
  onToggleBuffer: (bufferId: string) => void;
  onToggleFile: (filePath: string) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
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

// Fuzzy search scoring function (same as file mention dropdown)
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

export function ContextSelector({
  buffers,
  selectedBufferIds,
  selectedFilesPaths,
  onToggleBuffer,
  onToggleFile,
  isOpen,
  onToggleOpen,
}: Omit<ContextSelectorProps, "allProjectFiles">) {
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [allFiles, setAllFiles] = useState<Array<{ name: string; path: string; isDir: boolean }>>(
    [],
  );

  // Get rootFolderPath from project store and file system store
  const { rootFolderPath } = useProjectStore();
  const { getAllProjectFiles } = useFileSystemStore();

  // Load all project files on mount (same as file mention dropdown)
  useEffect(() => {
    getAllProjectFiles().then((projectFiles) => {
      const formattedFiles = projectFiles.map((file) => ({
        name: file.name,
        path: file.path,
        isDir: file.isDir,
      }));
      setAllFiles(formattedFiles);
    });
  }, [getAllProjectFiles]);

  // Get relative path for display (same as file mention dropdown)
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

  // Combined list of buffers and files with fuzzy search (same logic as file mention dropdown)
  const allItems = useMemo(() => {
    // Convert buffers to items
    const bufferItems = buffers.map((buffer) => ({
      type: "buffer" as const,
      id: buffer.id,
      name: buffer.name,
      path: buffer.path,
      isDir: false,
      isSQLite: buffer.isSQLite,
      isDirty: buffer.isDirty,
      isSelected: selectedBufferIds.has(buffer.id),
    }));

    // Convert project files to items (filter out directories and ignored files)
    const fileItems = allFiles
      .filter((file) => !file.isDir && !shouldIgnoreFile(file.path))
      .map((file) => ({
        type: "file" as const,
        id: file.path,
        name: file.name,
        path: file.path,
        isDir: false,
        isSelected: selectedFilesPaths.has(file.path),
      }));

    const allCombined = [...bufferItems, ...fileItems];

    if (!searchTerm.trim()) {
      // No search query - show buffers first, then alphabetical files
      return [
        ...bufferItems,
        ...fileItems.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20),
      ];
    }

    // With search query - use fuzzy search
    const scoredItems = allCombined
      .map((item) => {
        // Score both filename and full path, take the higher score
        const nameScore = fuzzyScore(item.name, searchTerm);
        const pathScore = fuzzyScore(item.path, searchTerm);
        const score = Math.max(nameScore, pathScore);

        return { item, score };
      })
      .filter(({ score }) => score > 0) // Only include items with positive scores
      .sort((a, b) => {
        // First sort by score (highest first)
        if (b.score !== a.score) return b.score - a.score;
        // Then sort alphabetically
        return a.item.name.localeCompare(b.item.name);
      })
      .slice(0, 20); // Limit to 20 results

    return scoredItems.map(({ item }) => item);
  }, [allFiles, buffers, searchTerm, selectedBufferIds, selectedFilesPaths]);

  // Get selected items for display
  const selectedItems = useMemo(() => {
    const bufferItems = buffers
      .filter((buffer) => selectedBufferIds.has(buffer.id))
      .map((buffer) => ({
        type: "buffer" as const,
        id: buffer.id,
        name: buffer.name,
        isSQLite: buffer.isSQLite,
        isDirty: buffer.isDirty,
      }));

    const fileItems = Array.from(selectedFilesPaths).map((filePath) => ({
      type: "file" as const,
      id: filePath,
      name: filePath.split("/").pop() || "Unknown",
      path: filePath,
    }));

    return [...bufferItems, ...fileItems];
  }, [buffers, selectedBufferIds, selectedFilesPaths]);

  // Calculate popover position to prevent screen overflow
  const getPopoverPosition = useCallback(() => {
    if (!dropdownRef.current) return { left: 0, right: "auto" };

    const rect = dropdownRef.current.getBoundingClientRect();
    const popoverWidth = 320;
    const padding = 8;

    // Check if there's enough space on the right
    if (rect.left + popoverWidth + padding <= window.innerWidth) {
      return { left: 0, right: "auto" };
    }

    // Position from the right edge of the trigger
    const rightOffset = window.innerWidth - rect.right;
    if (rightOffset + popoverWidth + padding <= window.innerWidth) {
      return { left: "auto", right: 0 };
    }

    // If it doesn't fit either way, position with padding from screen edge
    return {
      left: Math.max(padding - rect.left, -(popoverWidth - rect.width)),
      right: "auto",
    };
  }, []);

  // Handle ESC key to close dropdown
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        onToggleOpen();
      }
    },
    [isOpen, onToggleOpen],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <div className="relative flex-shrink-0" ref={dropdownRef}>
        <button
          onClick={onToggleOpen}
          className={cn(
            "flex select-none items-center justify-center rounded p-1",
            "text-text-lighter text-xs transition-colors",
            "hover:bg-hover hover:text-text focus:outline-none",
          )}
          title="Add context files"
          aria-label="Add context files"
          aria-expanded={isOpen}
          aria-haspopup="true"
        >
          <Plus size={12} />
        </button>

        {isOpen && (
          <div
            className={cn(
              "scrollbar-hidden fixed z-50 mt-1 overflow-y-auto rounded border border-border bg-secondary-bg shadow-lg",
              "select-none",
            )}
            style={{
              width: "320px",
              maxHeight: "300px",
              position: "absolute",
              bottom: "100%",
              ...getPopoverPosition(),
            }}
            role="dialog"
            aria-label="Context file selector"
            aria-modal="false"
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
                  className="w-full bg-transparent py-1 pr-2 pl-6 text-text text-xs placeholder-text-lighter focus:outline-none"
                  aria-label="Search files"
                />
              </div>
            </div>

            {/* Unified file list */}
            <div className="py-1" role="listbox" aria-label="Files and buffers">
              {allItems.length === 0 ? (
                <div className="px-3 py-2 text-center font-mono text-text-lighter text-xs">
                  {searchTerm ? "No matching files found" : "No files available"}
                </div>
              ) : (
                allItems.map((item) => (
                  <button
                    key={`${item.type}-${item.id}`}
                    onClick={() => {
                      if (item.type === "buffer") {
                        onToggleBuffer(item.id);
                      } else {
                        onToggleFile(item.path);
                      }
                    }}
                    className={cn(
                      "group flex w-full cursor-pointer items-center gap-2 px-3 py-1 text-left font-mono text-xs transition-colors hover:bg-hover focus:outline-none focus:ring-1 focus:ring-accent/50",
                      item.isSelected && "bg-selected",
                    )}
                    aria-label={`${item.isSelected ? "Remove" : "Add"} ${item.name} ${item.isSelected ? "from" : "to"} context`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      {item.type === "buffer" ? (
                        item.isSQLite ? (
                          <Database size={10} className="flex-shrink-0 text-text-lighter" />
                        ) : (
                          <FileText size={10} className="flex-shrink-0 text-text-lighter" />
                        )
                      ) : (
                        <FileIcon
                          fileName={item.name}
                          isDir={false}
                          size={10}
                          className="flex-shrink-0 text-text-lighter"
                        />
                      )}
                      <div className="min-w-0 flex-1 truncate">
                        <span className="text-text">{item.name}</span>
                        {item.type === "buffer" ? (
                          item.isDirty && (
                            <span
                              className="ml-1 text-[8px] text-yellow-500"
                              title="Unsaved changes"
                            >
                              ●
                            </span>
                          )
                        ) : (
                          <span className="ml-2 text-[10px] text-text-lighter opacity-60">
                            {getDirectoryPath(item.path) || "root"}
                          </span>
                        )}
                      </div>
                      {item.type === "buffer" && (
                        <span className="rounded bg-accent/20 px-1 py-0.5 font-medium text-[10px] text-accent">
                          open
                        </span>
                      )}
                    </div>
                    {item.isSelected && (
                      <div className="flex h-4 w-4 items-center justify-center rounded text-accent opacity-60">
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 16 16"
                          fill="currentColor"
                          aria-hidden="true"
                        >
                          <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z" />
                        </svg>
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Selected items as compact badges with horizontal scrolling */}
      <div className="scrollbar-hidden flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        {selectedItems.map((item) => (
          <div
            key={`selected-${item.type}-${item.id}`}
            className="group flex flex-shrink-0 select-none items-center gap-1 rounded border border-border bg-hover px-1.5 py-0.5 text-xs"
          >
            {item.type === "buffer" ? (
              item.isSQLite ? (
                <Database size={8} className="text-text-lighter" />
              ) : (
                <FileText size={8} className="text-text-lighter" />
              )
            ) : (
              <FileText size={8} className="text-blue-500" />
            )}
            <span
              className={cn(
                "max-w-20 truncate",
                item.type === "buffer" ? "text-text" : "text-blue-400",
              )}
            >
              {item.name}
            </span>
            {item.type === "buffer" && item.isDirty && (
              <span className="text-[8px] text-yellow-500" title="Unsaved changes">
                ●
              </span>
            )}
            <button
              onClick={() => {
                if (item.type === "buffer") {
                  onToggleBuffer(item.id);
                } else {
                  onToggleFile(item.id);
                }
              }}
              className="rounded text-text-lighter opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-red-400/50 group-hover:opacity-100"
              aria-label={`Remove ${item.name} from context`}
              tabIndex={0}
            >
              <svg width="8" height="8" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
