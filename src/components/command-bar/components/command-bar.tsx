import { ClockIcon, File } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useRecentFilesStore } from "@/file-system/controllers/recent-files-store";
import { useFileSystemStore } from "@/file-system/controllers/store";
import { useBufferStore } from "@/stores/buffer-store";
import { useUIState } from "@/stores/ui-state-store";
import { getRelativePath } from "@/utils/path-helpers";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";
import { shouldIgnoreInCommandPalette } from "../constants/ignored-patterns";

// Function to check if a file should be ignored
// Now using centralized filtering logic with improved path handling
const shouldIgnoreFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() || "";

  // Check if any directory in the path should be ignored
  const pathParts = filePath.split("/");
  for (const part of pathParts) {
    if (shouldIgnoreInCommandPalette(part, true)) {
      return true;
    }
  }

  // Check the filename itself
  return shouldIgnoreInCommandPalette(fileName, false);
};

// Fuzzy search scoring function
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

const CommandBar = () => {
  // Get data from stores
  const { isCommandBarVisible, setIsCommandBarVisible } = useUIState();
  const { getAllProjectFiles, rootFolderPath } = useFileSystemStore();
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);

  const isVisible = isCommandBarVisible;
  const onClose = () => setIsCommandBarVisible(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, 100); // Reduced debounce for faster response
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<Array<{ name: string; path: string; isDir: boolean }>>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Get data from stores
  const { buffers, activeBufferId } = useBufferStore();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const { addOrUpdateRecentFile, getRecentFilesOrderedByFrecency } = useRecentFilesStore();
  const recentFiles = getRecentFilesOrderedByFrecency();

  // Memoize filtered files to avoid recomputation with performance limits
  const filteredProjectFiles = useMemo(() => {
    return (allFiles: Array<{ name: string; path: string; isDir: boolean }>) => {
      const maxFilesToProcess = 2000; // Limit for UI performance
      return allFiles
        .slice(0, maxFilesToProcess) // Limit files processed upfront
        .filter((file) => !file.isDir && !shouldIgnoreFile(file.path)) // Pre-filter here
        .map((file) => ({
          name: file.name,
          path: file.path,
          isDir: file.isDir,
        }));
    };
  }, []);

  // Load all project files when component mounts or becomes visible
  useEffect(() => {
    if (!isVisible) return; // Only load when actually needed

    // Start with immediate response, then update when files are available
    const loadFiles = async () => {
      try {
        setIsLoadingFiles(files.length === 0); // Only show loading if no cached files
        const allFiles = await getAllProjectFiles();
        const formattedFiles = filteredProjectFiles(allFiles);
        setFiles(formattedFiles);
      } catch (error) {
        console.error("Failed to load project files:", error);
        // Don't fail completely, just use empty array
        setFiles([]);
      } finally {
        setIsLoadingFiles(false);
      }
    };

    loadFiles();
  }, [getAllProjectFiles, isVisible, filteredProjectFiles]); // Only reload when visible

  // Update local state when command bar becomes visible
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      setSelectedIndex(0);
      // Focus the input field immediately
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isVisible]);

  // Handle escape key and click outside
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }

      // Handle Cmd+K (or Ctrl+K on Windows/Linux)
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-command-bar]")) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isVisible, onClose]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Helper function to get directory path without filename
  const getDirectoryPath = useCallback(
    (fullPath: string): string => {
      const relativePath = getRelativePath(fullPath, rootFolderPath);
      const lastSlashIndex = relativePath.lastIndexOf("/");
      return lastSlashIndex > 0 ? relativePath.substring(0, lastSlashIndex) : "";
    },
    [rootFolderPath],
  );

  // Memoize file filtering and sorting
  const { openBufferFiles, recentFilesInResults, otherFiles } = useMemo(() => {
    // Files are already pre-filtered in the useEffect
    const allFiles = files;

    // Get open buffers (excluding active buffer)
    const openBufferPaths = buffers
      .filter((buffer) => buffer.id !== activeBufferId && !buffer.isVirtual)
      .map((buffer) => buffer.path);

    const openBufferFilesData = allFiles.filter((file) => openBufferPaths.includes(file.path));

    // Get recent file paths (excluding active buffer)
    const recentFilePaths = recentFiles
      .filter((rf) => !activeBuffer || rf.path !== activeBuffer.path)
      .map((rf) => rf.path);

    if (!debouncedQuery.trim()) {
      // No search query - show open buffers, then recent files by frecency, then alphabetical
      const recent = allFiles
        .filter(
          (file) => recentFilePaths.includes(file.path) && !openBufferPaths.includes(file.path),
        )
        .sort((a, b) => {
          const aIndex = recentFiles.findIndex((rf) => rf.path === a.path);
          const bIndex = recentFiles.findIndex((rf) => rf.path === b.path);
          return aIndex - bIndex; // Already sorted by frecency
        });

      const others = allFiles
        .filter(
          (file) =>
            !recentFilePaths.includes(file.path) &&
            !openBufferPaths.includes(file.path) &&
            (!activeBuffer || file.path !== activeBuffer.path),
        )
        .slice(0, 200) // Limit others to prevent UI freeze
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        openBufferFiles: openBufferFilesData,
        recentFilesInResults: recent.slice(0, 10),
        otherFiles: others.slice(0, 20 - openBufferFilesData.length - recent.length),
      };
    }

    // With search query - use fuzzy search with aggressive performance optimizations
    const maxSearchFiles = Math.min(500, allFiles.length); // Even more aggressive limit
    const scoredFiles = allFiles
      .slice(0, maxSearchFiles) // Limit initial processing for performance
      .map((file) => {
        // Score both filename and full path, take the higher score
        const nameScore = fuzzyScore(file.name, debouncedQuery);
        const pathScore = fuzzyScore(file.path, debouncedQuery);
        const score = Math.max(nameScore, pathScore);

        return { file, score };
      })
      .filter(({ score }) => score > 0) // Only include files with positive scores
      .sort((a, b) => {
        // First sort by score (highest first)
        if (b.score !== a.score) return b.score - a.score;

        // Then prioritize open buffers
        const aIsOpen = openBufferPaths.includes(a.file.path);
        const bIsOpen = openBufferPaths.includes(b.file.path);
        if (aIsOpen && !bIsOpen) return -1;
        if (!aIsOpen && bIsOpen) return 1;

        // Then prioritize recent files by frecency
        const aIsRecent = recentFilePaths.includes(a.file.path);
        const bIsRecent = recentFilePaths.includes(b.file.path);
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;

        if (aIsRecent && bIsRecent) {
          const aIndex = recentFiles.findIndex((rf) => rf.path === a.file.path);
          const bIndex = recentFiles.findIndex((rf) => rf.path === b.file.path);
          return aIndex - bIndex;
        }

        // Finally sort alphabetically
        return a.file.name.localeCompare(b.file.name);
      });

    const openBuffers = scoredFiles
      .filter(({ file }) => openBufferPaths.includes(file.path))
      .map(({ file }) => file);

    const recent = scoredFiles
      .filter(
        ({ file }) => recentFilePaths.includes(file.path) && !openBufferPaths.includes(file.path),
      )
      .map(({ file }) => file);

    const others = scoredFiles
      .filter(
        ({ file }) =>
          !recentFilePaths.includes(file.path) &&
          !openBufferPaths.includes(file.path) &&
          (!activeBuffer || file.path !== activeBuffer.path),
      )
      .map(({ file }) => file);

    return {
      openBufferFiles: openBuffers.slice(0, 20),
      recentFilesInResults: recent.slice(0, 20 - openBuffers.length),
      otherFiles: others.slice(0, 20 - openBuffers.length - recent.length),
    };
  }, [files, debouncedQuery, buffers, activeBufferId]); // Use debounced query for better performance

  const handleItemSelect = useCallback(
    (path: string) => {
      // Extract filename from path
      const fileName = path.split("/").pop() || path;

      // Update recent files store with frecency
      addOrUpdateRecentFile(path, fileName);

      handleFileSelect(path, false);
      onClose();
    },
    [handleFileSelect, onClose, addOrUpdateRecentFile],
  );

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!isVisible || !scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex, isVisible, openBufferFiles, recentFilesInResults, otherFiles]);

  // Handle arrow key navigation - separate effect after files are defined
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle arrow key navigation
      const allResults = [...openBufferFiles, ...recentFilesInResults, ...otherFiles];
      const totalItems = allResults.length;

      if (totalItems === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % totalItems); // Circular navigation
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems); // Circular navigation
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allResults[selectedIndex]) {
          handleItemSelect(allResults[selectedIndex].path);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isVisible,
    openBufferFiles,
    recentFilesInResults,
    otherFiles,
    selectedIndex,
    handleItemSelect,
  ]);

  if (!isVisible) {
    return null;
  }

  return (
    <Command isVisible={isVisible} className="max-h-80">
      <CommandHeader onClose={onClose}>
        <CommandInput
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Type to search files..."
          className="font-mono"
        />
      </CommandHeader>

      <CommandList ref={scrollContainerRef}>
        {openBufferFiles.length === 0 &&
        recentFilesInResults.length === 0 &&
        otherFiles.length === 0 ? (
          <CommandEmpty>
            <div className="font-mono">
              {isLoadingFiles
                ? "Loading files..."
                : debouncedQuery
                  ? "No matching files found"
                  : query
                    ? "Searching..."
                    : files.length === 0
                      ? "No files indexed yet"
                      : "No files available"}
            </div>
          </CommandEmpty>
        ) : (
          <>
            {/* Open Buffers Section */}
            {openBufferFiles.length > 0 && (
              <div className="p-0">
                {openBufferFiles.map((file, index) => {
                  const globalIndex = index;
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <CommandItem
                      key={`open-${file.path}`}
                      data-item-index={globalIndex}
                      onClick={() => handleItemSelect(file.path)}
                      isSelected={isSelected}
                      className="font-mono"
                    >
                      <File size={11} className="flex-shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">
                          <span className="text-text">{file.name}</span>
                          {getDirectoryPath(file.path) && (
                            <span className="ml-1.5 text-[10px] text-text-lighter opacity-60">
                              {getDirectoryPath(file.path)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="rounded bg-accent/20 px-1 py-0.5 font-medium text-[10px] text-accent">
                        open
                      </span>
                    </CommandItem>
                  );
                })}
              </div>
            )}

            {/* Recent Files Section - Minimal */}
            {recentFilesInResults.length > 0 && (
              <div className="p-0">
                {recentFilesInResults.map((file, index) => {
                  const globalIndex = openBufferFiles.length + index;
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <CommandItem
                      key={`recent-${file.path}`}
                      data-item-index={globalIndex}
                      onClick={() => handleItemSelect(file.path)}
                      isSelected={isSelected}
                      className="font-mono"
                    >
                      <File size={11} className="flex-shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">
                          <span className="text-text">{file.name}</span>
                          {getDirectoryPath(file.path) && (
                            <span className="ml-1.5 text-[10px] text-text-lighter opacity-60">
                              {getDirectoryPath(file.path)}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="rounded px-1 py-0.5 font-medium text-[10px] text-text-lighter">
                        <ClockIcon size={12} />
                      </span>
                    </CommandItem>
                  );
                })}
              </div>
            )}

            {/* Other Files Section - Minimal */}
            {otherFiles.length > 0 && (
              <div className="p-0">
                {otherFiles.map((file, index) => {
                  const globalIndex = openBufferFiles.length + recentFilesInResults.length + index;
                  const isSelected = globalIndex === selectedIndex;
                  return (
                    <CommandItem
                      key={`other-${file.path}`}
                      data-item-index={globalIndex}
                      onClick={() => handleItemSelect(file.path)}
                      isSelected={isSelected}
                      className="font-mono"
                    >
                      <File size={11} className="flex-shrink-0 text-text-lighter" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">
                          <span className="text-text">{file.name}</span>
                          {getDirectoryPath(file.path) && (
                            <span className="ml-1.5 text-[10px] text-text-lighter opacity-60">
                              {getDirectoryPath(file.path)}
                            </span>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );
};

export default CommandBar;
