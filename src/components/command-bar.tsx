import { useState, useEffect, useMemo, useCallback } from "react";
import { File, Command as CommandIcon, X, Clock } from "lucide-react";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "./ui/command";

interface CommandBarProps {
  isVisible: boolean;
  onClose: () => void;
  files: Array<{ name: string; path: string; isDir: boolean }>;
  onFileSelect: (path: string) => void;
  rootFolderPath?: string;
}

// Storage key for recently opened files
const RECENT_FILES_KEY = "athas-recent-files";

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

  // Initialize cache when component mounts
  useEffect(() => {
    initializeCache();
  }, []);

  // Update local state when command bar becomes visible
  useEffect(() => {
    if (isVisible) {
      setQuery("");
      // Use cached recent files or empty array if cache not ready
      setRecentFiles(cacheInitialized ? [...recentFilesCache] : []);
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

  // Memoize file filtering and sorting
  const { recentFilesInResults, otherFiles } = useMemo(() => {
    const allFiles = files.filter(entry => !entry.isDir);

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

    // With search query - filter first, then prioritize recent files
    const queryLower = query.toLowerCase();
    const filtered = allFiles.filter(
      file =>
        file.name.toLowerCase().includes(queryLower)
        || file.path.toLowerCase().includes(queryLower),
    );

    const recent = filtered
      .filter(file => recentFiles.includes(file.path))
      .sort((a, b) => recentFiles.indexOf(a.path) - recentFiles.indexOf(b.path));

    const others = filtered
      .filter(file => !recentFiles.includes(file.path))
      .sort((a, b) => a.name.localeCompare(b.name));

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

  if (!isVisible) {
    return null;
  }

  return (
    <div className="fixed inset-0 flex items-start justify-center pt-20 z-50 pointer-events-none">
      <div
        data-command-bar
        className="bg-[var(--secondary-bg)] border border-[var(--border-color)] rounded-lg shadow-2xl w-96 max-h-96 overflow-hidden pointer-events-auto"
      >
        <Command className="bg-transparent border-none shadow-none" shouldFilter={false}>
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border-color)]">
            <CommandIcon size={14} className="text-[var(--text-lighter)]" />
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Type to search files..."
              className="flex-1 bg-transparent text-[var(--text-color)] text-sm font-mono focus:outline-none placeholder-[var(--text-lighter)] border-none h-auto py-0 shadow-none ring-0 focus:ring-0"
              autoFocus
            />
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--hover-color)] transition-colors duration-150"
            >
              <X size={14} className="text-[var(--text-lighter)]" />
            </button>
          </div>

          {/* Command List */}
          <CommandList className="max-h-80 overflow-y-auto custom-scrollbar bg-transparent">
            <CommandEmpty className="px-4 py-6 text-center text-[var(--text-lighter)] text-sm font-mono">
              {query ? "No matching files found" : "No files available"}
            </CommandEmpty>

            {/* Recent Files Section */}
            {recentFilesInResults.length > 0 && (
              <CommandGroup className="p-0">
                <div className="px-4 py-2 text-xs font-medium text-[var(--text-lighter)] border-b border-[var(--border-color)] bg-[var(--primary-bg)]">
                  <div className="flex items-center gap-2">
                    <Clock size={12} />
                    Recently Opened
                  </div>
                </div>
                {recentFilesInResults.map(file => (
                  <CommandItem
                    key={`recent-${file.path}`}
                    value={`${file.name} ${file.path}`}
                    onSelect={() => handleFileSelect(file.path)}
                    className="px-4 py-2 flex items-center gap-3 cursor-pointer aria-selected:bg-[var(--selected-color)] aria-selected:text-[var(--text-color)] hover:bg-[var(--hover-color)] font-mono m-0 rounded-none border-none bg-transparent transition-colors duration-150"
                  >
                    <File size={14} className="text-blue-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--text-color)] truncate">{file.name}</div>
                      <div className="text-xs text-[var(--text-lighter)] truncate">
                        {getRelativePath(file.path)}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Other Files Section */}
            {otherFiles.length > 0 && (
              <CommandGroup className="p-0">
                {recentFilesInResults.length > 0 && (
                  <div className="px-4 py-2 text-xs font-medium text-[var(--text-lighter)] border-b border-[var(--border-color)] bg-[var(--primary-bg)]">
                    Other Files
                  </div>
                )}
                {otherFiles.map(file => (
                  <CommandItem
                    key={`other-${file.path}`}
                    value={`${file.name} ${file.path}`}
                    onSelect={() => handleFileSelect(file.path)}
                    className="px-4 py-2 flex items-center gap-3 cursor-pointer aria-selected:bg-[var(--selected-color)] aria-selected:text-[var(--text-color)] hover:bg-[var(--hover-color)] font-mono m-0 rounded-none border-none bg-transparent transition-colors duration-150"
                  >
                    <File size={14} className="text-[var(--text-lighter)]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[var(--text-color)] truncate">{file.name}</div>
                      <div className="text-xs text-[var(--text-lighter)] truncate">
                        {getRelativePath(file.path)}
                      </div>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
};

export default CommandBar;
