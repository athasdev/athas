import { ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { FileEntry } from "../types/app";
import { readFile } from "../utils/platform";
import FileIcon from "./file-icon";
import Button from "./ui/button";

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

export interface SearchViewRef {
  focusInput: () => void;
}

const SearchView = forwardRef<SearchViewRef, SearchViewProps>(
  ({ rootFolderPath, allProjectFiles, onFileSelect }, ref) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Expose focus method through ref
    useImperativeHandle(
      ref,
      () => ({
        focusInput: () => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        },
      }),
      [],
    );

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

    const performSearch = useCallback(
      async (query: string) => {
        if (!query.trim() || !rootFolderPath) {
          setSearchResults([]);
          return;
        }

        // Cancel previous search
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }

        abortControllerRef.current = new AbortController();
        const signal = abortControllerRef.current.signal;

        setIsSearching(true);
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

          const textFiles = allProjectFiles.filter(file => {
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
              chunk.map(async file => {
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
            await new Promise(resolve => requestAnimationFrame(resolve));
          }

          if (!signal.aborted) {
            setSearchResults(results);
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

    const clearSearch = () => {
      setSearchQuery("");
      setSearchResults([]);
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
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
          <span key={index} className="bg-yellow-200 text-yellow-900 px-0.5 rounded">
            {part}
          </span>
        ) : (
          part
        ),
      );
    };

    return (
      <div className="flex flex-col h-full">
        {/* Search Input */}
        <div className="p-3 border-b border-[var(--border-color)]">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)]"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search in files..."
              className="w-full pl-8 pr-8 py-2 text-xs bg-[var(--primary-bg)] border border-[var(--border-color)] rounded focus:outline-none focus:ring-1 focus:ring-blue-500 text-[var(--text-color)]"
            />
            {searchQuery && (
              <button
                onClick={clearSearch}
                className="absolute right-2 top-1/2 transform -translate-y-1/2 text-[var(--text-lighter)] hover:text-[var(--text-color)]"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Search Options */}
          <div className="flex gap-1 mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCaseSensitive(!caseSensitive)}
              className={`text-xs px-2 py-1 ${caseSensitive ? "bg-[var(--selected-color)]" : ""}`}
              title="Match Case"
            >
              Aa
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWholeWord(!wholeWord)}
              className={`text-xs px-2 py-1 ${wholeWord ? "bg-[var(--selected-color)]" : ""}`}
              title="Match Whole Word"
            >
              Ab
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUseRegex(!useRegex)}
              className={`text-xs px-2 py-1 ${useRegex ? "bg-[var(--selected-color)]" : ""}`}
              title="Use Regular Expression"
            >
              .*
            </Button>
          </div>
        </div>

        {/* Search Results */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {isSearching && (
            <div className="p-4 text-center text-[var(--text-lighter)] text-xs">Searching...</div>
          )}

          {!isSearching && searchQuery && searchResults.length === 0 && (
            <div className="p-4 text-center text-[var(--text-lighter)] text-xs">
              No results found
            </div>
          )}

          {!isSearching && searchResults.length > 0 && (
            <div className="p-2">
              <div className="text-xs text-[var(--text-lighter)] mb-2 px-1">
                {searchResults.length >= MAX_RESULTS ? `${MAX_RESULTS}+` : searchResults.length}{" "}
                result{searchResults.length !== 1 ? "s" : ""} in{" "}
                {Object.keys(groupedResults).length} file
                {Object.keys(groupedResults).length !== 1 ? "s" : ""}
                {searchResults.length >= MAX_RESULTS && (
                  <span className="text-yellow-600 ml-2">(limited)</span>
                )}
              </div>

              {Object.entries(groupedResults).map(([filePath, results]) => (
                <div key={filePath} className="mb-2">
                  {/* File Header */}
                  <button
                    onClick={() => handleFileToggle(filePath)}
                    className="flex items-center gap-1 w-full p-1 hover:bg-[var(--hover-color)] rounded text-left"
                  >
                    {expandedFiles.has(filePath) ? (
                      <ChevronDown size={12} className="text-[var(--text-lighter)]" />
                    ) : (
                      <ChevronRight size={12} className="text-[var(--text-lighter)]" />
                    )}
                    <FileIcon fileName={getFileName(filePath)} isDir={false} size={12} />
                    <span className="text-xs font-medium text-[var(--text-color)] truncate">
                      {getFileName(filePath)}
                    </span>
                    <span className="text-xs text-[var(--text-lighter)] ml-auto">
                      {results.length}
                    </span>
                  </button>

                  {/* File Path */}
                  <div className="text-xs text-[var(--text-lighter)] ml-6 mb-1 truncate">
                    {getRelativePath(filePath)}
                  </div>

                  {/* Results */}
                  {expandedFiles.has(filePath) && (
                    <div className="ml-6 space-y-1">
                      {results.map((result, index) => (
                        <button
                          key={index}
                          onClick={() => handleResultClick(result)}
                          className="flex items-start gap-2 w-full p-1 hover:bg-[var(--hover-color)] rounded text-left"
                        >
                          <span className="text-xs text-[var(--text-lighter)] min-w-[2rem] text-right">
                            {result.line}
                          </span>
                          <span className="text-xs text-[var(--text-color)] flex-1 truncate">
                            {highlightMatch(result.text, result.match)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {!searchQuery && !isSearching && (
            <div className="p-4 text-center text-[var(--text-lighter)] text-xs">
              Enter a search term to find text across your project files
            </div>
          )}
        </div>
      </div>
    );
  },
);

SearchView.displayName = "SearchView";

export default SearchView;
