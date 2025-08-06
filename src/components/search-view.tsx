import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/utils/cn";
import FileIcon from "../file-explorer/views/file.icon";
import { readFile } from "../file-system/controllers/platform";
import type { FileEntry } from "../file-system/models/app";
import Toggle from "./ui/toggle";
import Tooltip from "./ui/tooltip";

interface SearchResult {
  file: string;
  line: number;
  column: number;
  text: string;
  match: string;
}

interface SearchViewProps {
  rootFolderPath?: string;
  allProjectFiles: FileEntry[];
  onFileSelect: (path: string, line?: number, column?: number) => void;
}

const SearchView = ({ rootFolderPath, allProjectFiles, onFileSelect }: SearchViewProps) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const resultRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Focus method can be called directly on the component if needed in the future

  // Performance constants
  const MAX_RESULTS = 1000;
  const MAX_FILE_SIZE = 1024 * 1024; // 1MB limit
  const CHUNK_SIZE = 50; // Process files in chunks

  // Group results by file
  const groupedResults = searchResults.reduce(
    (acc, result) => {
      if (!acc[result.file]) {
        acc[result.file] = [];
      }
      acc[result.file].push(result);
      return acc;
    },
    {} as Record<string, SearchResult[]>,
  );

  // Get flat list of all results for keyboard navigation
  const flatResults = useMemo(() => {
    const results: { file: string; result: SearchResult; index: number }[] = [];
    Object.entries(groupedResults).forEach(([file, fileResults]) => {
      if (expandedFiles.has(file)) {
        fileResults.forEach((result, index) => {
          results.push({ file, result, index });
        });
      }
    });
    return results;
  }, [groupedResults, expandedFiles]);

  const performSearch = useCallback(
    async (query: string) => {
      if (!query.trim() || !rootFolderPath) {
        setSearchResults([]);
        setHasSearched(false);
        setSelectedIndex(-1);
        return;
      }

      // Cancel previous search
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      setIsSearching(true);
      setHasSearched(false);
      setSelectedIndex(-1);
      const results: SearchResult[] = [];

      try {
        // Better file filtering - exclude more file types and check extensions
        const textFileExtensions = new Set([
          "txt",
          "md",
          "js",
          "ts",
          "jsx",
          "tsx",
          "css",
          "scss",
          "sass",
          "less",
          "html",
          "htm",
          "xml",
          "json",
          "yaml",
          "yml",
          "toml",
          "ini",
          "cfg",
          "py",
          "rb",
          "php",
          "java",
          "c",
          "cpp",
          "h",
          "hpp",
          "cs",
          "go",
          "rs",
          "swift",
          "kt",
          "scala",
          "clj",
          "sh",
          "bash",
          "zsh",
          "fish",
          "ps1",
          "bat",
          "cmd",
          "vim",
          "lua",
          "pl",
          "r",
          "sql",
          "graphql",
          "vue",
          "svelte",
          "astro",
          "elm",
          "dart",
          "hx",
          "nim",
          "crystal",
        ]);

        const textFiles = allProjectFiles.filter((file) => {
          if (file.isDir) return false;

          const extension = file.name.split(".").pop()?.toLowerCase();
          return extension && textFileExtensions.has(extension);
        });

        // Prepare search pattern once
        let searchPattern: RegExp;
        try {
          if (useRegex) {
            searchPattern = new RegExp(query, caseSensitive ? "g" : "gi");
          } else {
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const pattern = wholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
            searchPattern = new RegExp(pattern, caseSensitive ? "g" : "gi");
          }
        } catch {
          // If regex is invalid, fall back to literal search
          const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          searchPattern = new RegExp(escapedQuery, caseSensitive ? "g" : "gi");
        }

        // Process files in chunks for better responsiveness
        for (let i = 0; i < textFiles.length; i += CHUNK_SIZE) {
          if (signal.aborted) break;

          const chunk = textFiles.slice(i, i + CHUNK_SIZE);

          await Promise.all(
            chunk.map(async (file) => {
              if (signal.aborted) return;

              try {
                // Use the platform file reading utility with size check
                const content = await readFile(file.path).catch(() => "");
                if (!content || content.length > MAX_FILE_SIZE) return;

                const lines = content.split("\n");

                for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
                  if (signal.aborted || results.length >= MAX_RESULTS) break;

                  const line = lines[lineIndex];
                  searchPattern.lastIndex = 0; // Reset regex state

                  let match: RegExpExecArray | null;
                  while (true) {
                    match = searchPattern.exec(line);
                    if (match === null) break;
                    if (results.length >= MAX_RESULTS) break;

                    results.push({
                      file: file.path,
                      line: lineIndex + 1,
                      column: match.index + 1,
                      text: line.trim(),
                      match: match[0],
                    });

                    // Prevent infinite loop with zero-width matches
                    if (match.index === searchPattern.lastIndex) {
                      searchPattern.lastIndex++;
                    }
                  }
                }
              } catch (error) {
                console.warn(`Error searching file ${file.path}:`, error);
              }
            }),
          );

          // Allow UI to update between chunks - use requestAnimationFrame for better performance
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }

        if (!signal.aborted) {
          setSearchResults(results);
          setHasSearched(true);
          // Auto-expand first file with results
          if (results.length > 0) {
            const firstFile = results[0].file;
            setExpandedFiles(new Set([firstFile]));
          }
        }
      } catch (error) {
        if (!signal.aborted) {
          console.error("Search error:", error);
        }
      } finally {
        if (!signal.aborted) {
          setIsSearching(false);
        }
      }
    },
    [allProjectFiles, rootFolderPath, caseSensitive, wholeWord, useRegex],
  );

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, performSearch]);

  const handleFileToggle = (filePath: string) => {
    const newExpanded = new Set(expandedFiles);
    if (newExpanded.has(filePath)) {
      newExpanded.delete(filePath);
    } else {
      newExpanded.add(filePath);
    }
    setExpandedFiles(newExpanded);
  };

  const handleResultClick = (result: SearchResult) => {
    onFileSelect(result.file, result.line, result.column);
  };

  const getFileName = (filePath: string) => {
    return filePath.split("/").pop() || filePath;
  };

  const getRelativePath = (filePath: string) => {
    if (!rootFolderPath) return filePath;
    return filePath.replace(rootFolderPath, "").replace(/^\//, "");
  };

  const highlightMatch = (text: string, match: string) => {
    if (!match) return text;

    const regex = new RegExp(`(${match.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(regex);

    return parts.map((part, index) =>
      regex.test(part) ? (
        <span key={index} className="rounded bg-yellow-200 px-0.5 text-yellow-900">
          {part}
        </span>
      ) : (
        part
      ),
    );
  };

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = Math.min(prev + 1, flatResults.length - 1);
          // Scroll to the selected item
          const key = `${flatResults[newIndex]?.file}-${flatResults[newIndex]?.index}`;
          const element = resultRefs.current.get(key);
          element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          return newIndex;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => {
          const newIndex = Math.max(prev - 1, -1);
          if (newIndex >= 0) {
            const key = `${flatResults[newIndex]?.file}-${flatResults[newIndex]?.index}`;
            const element = resultRefs.current.get(key);
            element?.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
          return newIndex;
        });
      } else if (e.key === "Enter" && selectedIndex >= 0 && flatResults[selectedIndex]) {
        e.preventDefault();
        handleResultClick(flatResults[selectedIndex].result);
      }
    },
    [flatResults, selectedIndex, handleResultClick],
  );

  // Handle mouse wheel scrolling on the entire search container
  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const searchContainer = searchContainerRef.current;
    if (!scrollContainer || !searchContainer) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle if the event target is within the entire search view
      if (searchContainer.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();

        // Apply scroll to the results container with multiplier for faster scrolling
        const scrollSpeed = 1.5; // Increase this for faster scrolling
        const scrollAmount = e.deltaY * scrollSpeed;

        // Use direct scrollTop manipulation for smoother performance
        scrollContainer.scrollTop += scrollAmount;
      }
    };

    // Add listener to the document to capture all wheel events
    document.addEventListener("wheel", handleWheel, {
      passive: false,
      capture: true,
    });

    return () => {
      document.removeEventListener("wheel", handleWheel, { capture: true });
    };
  }, []);

  return (
    <div
      ref={searchContainerRef}
      className="flex h-full select-none flex-col"
      onKeyDown={handleKeyDown}
    >
      {/* Search Input and Options */}
      <div className="select-none border-border border-b bg-secondary-bg px-2 py-1">
        <div className="relative flex w-full items-center">
          <span className="pointer-events-none absolute left-2 z-10 text-text-lighter">
            <Search size={11} />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search"
            className="h-6 w-full border-none bg-transparent pr-18 pl-6 text-text text-xs focus:outline-none focus:ring-0"
            style={{
              borderRadius: 0,
              boxShadow: "none",
              userSelect: "text",
              WebkitUserSelect: "text",
              MozUserSelect: "text",
            }}
          />
          <div className="absolute right-0 flex items-center gap-0.5">
            <Tooltip content="Match Case" side="bottom">
              <Toggle
                pressed={caseSensitive}
                onPressedChange={setCaseSensitive}
                size="xs"
                style={{ fontSize: "10px" }}
              >
                Aa
              </Toggle>
            </Tooltip>
            <Tooltip content="Match Whole Word" side="bottom">
              <Toggle
                pressed={wholeWord}
                onPressedChange={setWholeWord}
                size="xs"
                style={{ fontSize: "10px" }}
              >
                Ab
              </Toggle>
            </Tooltip>
            <Tooltip content="Use Regular Expression" side="bottom">
              <Toggle
                pressed={useRegex}
                onPressedChange={setUseRegex}
                size="xs"
                style={{ fontSize: "10px" }}
              >
                .*
              </Toggle>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Search Results */}
      <div
        ref={scrollContainerRef}
        className="custom-scrollbar flex-1 overflow-y-auto overflow-x-hidden"
        style={{
          overscrollBehavior: "contain",
          height: "100%",
          position: "relative",
          scrollBehavior: "auto", // Disable smooth scrolling for better performance
        }}
      >
        {isSearching && (
          <div className="p-3 text-center text-text-lighter text-xs">Searching...</div>
        )}

        {!isSearching && hasSearched && searchQuery && searchResults.length === 0 && (
          <div className="p-3 text-center text-text-lighter text-xs">No results found</div>
        )}

        {!isSearching && searchResults.length > 0 && (
          <div className="p-2">
            <div className="mb-2 px-2 text-text-lighter text-xs">
              {searchResults.length >= MAX_RESULTS ? `${MAX_RESULTS}+` : searchResults.length}{" "}
              result{searchResults.length !== 1 ? "s" : ""} in {Object.keys(groupedResults).length}{" "}
              file
              {Object.keys(groupedResults).length !== 1 ? "s" : ""}
              {searchResults.length >= MAX_RESULTS && (
                <span className="ml-2 text-yellow-600">(limited)</span>
              )}
            </div>

            {Object.entries(groupedResults).map(([filePath, results]) => (
              <div key={filePath} className="mb-2">
                {/* File Header */}
                <button
                  onClick={() => handleFileToggle(filePath)}
                  className="flex w-full items-center gap-1 rounded px-1 py-1 text-left hover:bg-hover"
                >
                  {expandedFiles.has(filePath) ? (
                    <ChevronDown size={12} className="text-text-lighter" />
                  ) : (
                    <ChevronRight size={12} className="text-text-lighter" />
                  )}
                  <FileIcon fileName={getFileName(filePath)} isDir={false} size={12} />
                  <span className="truncate font-medium text-text text-xs">
                    {getFileName(filePath)}
                  </span>
                  <span className="ml-auto text-text-lighter text-xs">{results.length}</span>
                </button>

                {/* File Path */}
                <div className="mb-1 ml-6 truncate text-text-lighter text-xs">
                  {getRelativePath(filePath)}
                </div>

                {/* Results */}
                {expandedFiles.has(filePath) && (
                  <div className="ml-6 space-y-0.5">
                    {results.map((result, index) => {
                      const flatIndex = flatResults.findIndex(
                        (fr) => fr.file === filePath && fr.index === index,
                      );
                      const isSelected = flatIndex === selectedIndex;
                      const key = `${filePath}-${index}`;

                      return (
                        <button
                          key={index}
                          ref={(el) => {
                            if (el) resultRefs.current.set(key, el);
                            else resultRefs.current.delete(key);
                          }}
                          onClick={() => handleResultClick(result)}
                          className={cn(
                            "flex w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-hover",
                            isSelected && "bg-selected",
                          )}
                        >
                          <span className="min-w-[2rem] text-right text-text-lighter text-xs">
                            {result.line}
                          </span>
                          <span className="flex-1 truncate text-text text-xs">
                            {highlightMatch(result.text, result.match)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

SearchView.displayName = "SearchView";

export default SearchView;
