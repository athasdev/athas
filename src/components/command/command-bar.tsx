import { File, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface CommandBarProps {
  isVisible: boolean;
  onClose: () => void;
  files: Array<{ name: string; path: string; isDir: boolean }>;
  onFileSelect: (path: string) => void;
  rootFolderPath?: string;
}

// Storage key for recently opened files
const RECENT_FILES_KEY = "athas-recent-files";

// Files and directories to ignore in the command bar
const IGNORED_PATTERNS = [
  // Dependencies
  "node_modules",
  ".npm",
  ".yarn",
  ".pnpm-store",

  // Version control (only .git directory, not .gitignore)
  ".git",
  ".svn",
  ".hg",

  // Build outputs
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".output",
  "target",
  "bin",
  "obj",

  // IDE/Editor temporary files
  "*.swp",
  "*.swo",
  "*~",
  ".DS_Store",
  "Thumbs.db",

  // Cache directories
  ".cache",
  ".tmp",
  ".temp",
  "tmp",
  "temp",
  ".turbo",

  // Log files
  "*.log",
  "logs",

  // Coverage reports
  "coverage",
  ".nyc_output",

  // Misc cache
  ".sass-cache",
  ".eslintcache",
  ".parcel-cache",
];

// Function to check if a file should be ignored
const shouldIgnoreFile = (filePath: string): boolean => {
  const fileName = filePath.split("/").pop() || "";
  const fullPath = filePath.toLowerCase();

  return IGNORED_PATTERNS.some(pattern => {
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

// In-memory cache for recent files to avoid localStorage reads
// TODO: This is a hack to avoid localStorage reads. We should use redis maybe .
let recentFilesCache: string[] = [];
let cacheInitialized = false;

// Initialize cache asynchronously
const initializeCache = () => {
  if (cacheInitialized) return;

  setTimeout(() => {
    try {
      const stored = localStorage.getItem(RECENT_FILES_KEY);
      recentFilesCache = stored ? JSON.parse(stored) : [];
      cacheInitialized = true;
    } catch {
      recentFilesCache = [];
      cacheInitialized = true;
    }
  }, 0);
};

// Add file to recent files (async, non-blocking)
const addToRecentFiles = (filePath: string) => {
  // Update cache immediately for instant UI update
  const filtered = recentFilesCache.filter(path => path !== filePath);
  recentFilesCache = [filePath, ...filtered].slice(0, 20);

  // Persist to localStorage asynchronously (non-blocking)
  setTimeout(() => {
    try {
      localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recentFilesCache));
    } catch {
      // Ignore localStorage errors
    }
  }, 0);
};

const CommandBar = ({
  isVisible,
  onClose,
  files,
  onFileSelect,
  rootFolderPath,
}: CommandBarProps) => {
  const [query, setQuery] = useState("");
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Initialize cache when component mounts
  useEffect(() => {
    initializeCache();
  }, []);

  // Update local state when command bar becomes visible
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      setSelectedIndex(0);
      // Use cached recent files or empty array if cache not ready
      setRecentFiles(cacheInitialized ? [...recentFilesCache] : []);
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

  // Memoize relative path function
  const getRelativePath = useCallback(
    (fullPath: string): string => {
      if (!rootFolderPath) return fullPath;

      const normalizedFullPath = fullPath.replace(/\\/g, "/");
      const normalizedRootPath = rootFolderPath.replace(/\\/g, "/");

      if (normalizedFullPath.startsWith(normalizedRootPath)) {
        const relativePath = normalizedFullPath.substring(normalizedRootPath.length);
        return relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
      }

      return fullPath;
    },
    [rootFolderPath],
  );

  // Helper function to get directory path without filename
  const getDirectoryPath = useCallback(
    (fullPath: string): string => {
      const relativePath = getRelativePath(fullPath);
      const lastSlashIndex = relativePath.lastIndexOf("/");
      return lastSlashIndex > 0 ? relativePath.substring(0, lastSlashIndex) : "";
    },
    [getRelativePath],
  );

  // Memoize file filtering and sorting
  const { recentFilesInResults, otherFiles } = useMemo(() => {
    const allFiles = files.filter(entry => !entry.isDir && !shouldIgnoreFile(entry.path));

    if (!query.trim()) {
      // No search query - show recent files first, then alphabetical
      const recent = allFiles
        .filter(file => recentFiles.includes(file.path))
        .sort((a, b) => recentFiles.indexOf(a.path) - recentFiles.indexOf(b.path));

      const others = allFiles
        .filter(file => !recentFiles.includes(file.path))
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        recentFilesInResults: recent.slice(0, 10),
        otherFiles: others.slice(0, 20 - recent.length),
      };
    }

    // With search query - use fuzzy search
    const scoredFiles = allFiles
      .map(file => {
        // Score both filename and full path, take the higher score
        const nameScore = fuzzyScore(file.name, query);
        const pathScore = fuzzyScore(file.path, query);
        const score = Math.max(nameScore, pathScore);

        return { file, score };
      })
      .filter(({ score }) => score > 0) // Only include files with positive scores
      .sort((a, b) => {
        // First sort by score (highest first)
        if (b.score !== a.score) return b.score - a.score;

        // Then prioritize recent files
        const aIsRecent = recentFiles.includes(a.file.path);
        const bIsRecent = recentFiles.includes(b.file.path);
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;

        // Finally sort alphabetically
        return a.file.name.localeCompare(b.file.name);
      });

    const recent = scoredFiles
      .filter(({ file }) => recentFiles.includes(file.path))
      .map(({ file }) => file);

    const others = scoredFiles
      .filter(({ file }) => !recentFiles.includes(file.path))
      .map(({ file }) => file);

    return {
      recentFilesInResults: recent.slice(0, 20),
      otherFiles: others.slice(0, 20 - recent.length),
    };
  }, [files, recentFiles, query]);

  const handleFileSelect = useCallback(
    (path: string) => {
      // Update cache and state immediately
      addToRecentFiles(path);
      setRecentFiles(prev => {
        const filtered = prev.filter(p => p !== path);
        return [path, ...filtered].slice(0, 20);
      });

      onFileSelect(path);
      onClose();
    },
    [onFileSelect, onClose],
  );

  // Handle arrow key navigation - separate effect after files are defined
  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle arrow key navigation
      const allResults = [...recentFilesInResults, ...otherFiles];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex(prev => (prev < allResults.length - 1 ? prev + 1 : prev));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (allResults[selectedIndex]) {
          handleFileSelect(allResults[selectedIndex].path);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isVisible, recentFilesInResults, otherFiles, selectedIndex, handleFileSelect]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-20">
      <div
        data-command-bar
        className="pointer-events-auto max-h-96 w-[600px] overflow-hidden rounded-lg border border-border bg-primary-bg shadow-2xl"
      >
        <div className="flex h-full w-full flex-col overflow-hidden">
          {/* Minimal Header */}
          <div className="flex items-center gap-3 px-4 py-3">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Type to search files..."
              className="h-auto flex-1 border-none bg-transparent py-0 font-mono text-sm text-text placeholder-text-lighter outline-none"
            />
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded p-1 transition-colors duration-150 hover:bg-hover"
            >
              <X size={16} className="text-text-lighter" />
            </button>
          </div>

          {/* Command List */}
          <div className="custom-scrollbar max-h-80 overflow-y-auto bg-transparent">
            {recentFilesInResults.length === 0 && otherFiles.length === 0 ? (
              <div className="px-4 py-6 text-center font-mono text-sm text-text-lighter">
                {query ? "No matching files found" : "No files available"}
              </div>
            ) : (
              <>
                {/* Recent Files Section - Minimal */}
                {recentFilesInResults.length > 0 && (
                  <div className="p-0">
                    {recentFilesInResults.map((file, index) => {
                      const globalIndex = index;
                      const isSelected = globalIndex === selectedIndex;
                      return (
                        <button
                          key={`recent-${file.path}`}
                          onClick={() => handleFileSelect(file.path)}
                          className={`m-0 flex w-full cursor-pointer items-center gap-2 rounded-none border-none px-3 py-1.5 font-mono transition-colors duration-150 ${
                            isSelected ? "bg-selected" : "bg-transparent hover:bg-hover"
                          }`}
                        >
                          <File size={13} className="text-accent" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm">
                              <span className="text-text">{file.name}</span>
                              {getDirectoryPath(file.path) && (
                                <span className="ml-2 text-text-lighter text-xs opacity-60">
                                  {getDirectoryPath(file.path)}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent text-xs">
                              recent
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Other Files Section - Minimal */}
                {otherFiles.length > 0 && (
                  <div className="p-0">
                    {otherFiles.map((file, index) => {
                      const globalIndex = recentFilesInResults.length + index;
                      const isSelected = globalIndex === selectedIndex;
                      return (
                        <button
                          key={`other-${file.path}`}
                          onClick={() => handleFileSelect(file.path)}
                          className={`m-0 flex w-full cursor-pointer items-center gap-2 rounded-none border-none px-3 py-1.5 font-mono transition-colors duration-150 ${
                            isSelected ? "bg-selected" : "bg-transparent hover:bg-hover"
                          }`}
                        >
                          <File size={13} className="text-text-lighter" />
                          <div className="min-w-0 flex-1 text-left">
                            <div className="truncate text-sm">
                              <span className="text-text">{file.name}</span>
                              {getDirectoryPath(file.path) && (
                                <span className="ml-2 text-text-lighter text-xs opacity-60">
                                  {getDirectoryPath(file.path)}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommandBar;
