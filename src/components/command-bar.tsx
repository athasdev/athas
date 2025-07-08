import { useState, useEffect, useMemo, useCallback } from "react";
import { File, Command as CommandIcon, X } from "lucide-react";
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
        className="bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl w-96 max-h-96 overflow-hidden pointer-events-auto"
      >
        <Command className="bg-transparent border-none shadow-none" shouldFilter={false}>
          {/* Minimal Header */}
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center">
              <CommandIcon size={16} className="text-[#666]" />
              <CommandInput
                value={query}
                onValueChange={setQuery}
                placeholder="Type to search files..."
                className="flex-1 bg-transparent text-[#e0e0e0] text-sm font-mono focus:outline-none placeholder-[#666] border-none h-auto py-0 shadow-none ring-0 focus:ring-0"
                autoFocus
              />
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#333] transition-colors duration-150"
            >
              <X size={16} className="text-[#666]" />
            </button>
          </div>

          {/* Command List */}
          <CommandList className="max-h-80 overflow-y-auto custom-scrollbar bg-transparent">
            <CommandEmpty className="px-4 py-6 text-center text-[#666] text-sm font-mono">
              {query ? "No matching files found" : "No files available"}
            </CommandEmpty>

            {/* Recent Files Section - Minimal */}
            {recentFilesInResults.length > 0 && (
              <CommandGroup className="p-0">
                {recentFilesInResults.map((file, index) => (
                  <CommandItem
                    key={`recent-${file.path}`}
                    value={`${file.name} ${file.path}`}
                    onSelect={() => handleFileSelect(file.path)}
                    className="px-4 py-2 flex items-center gap-3 cursor-pointer aria-selected:bg-[#2a2a2a] aria-selected:text-[#e0e0e0] hover:bg-[#2a2a2a] font-mono m-0 rounded-none border-none bg-transparent transition-colors duration-150"
                  >
                    <File size={16} className="text-[#8ab4f8]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#e0e0e0] truncate">{file.name}</div>
                      <div className="text-xs text-[#666] truncate">
                        {getRelativePath(file.path)}
                      </div>
                    </div>
                    {index < 3 && (
                      <div className="w-1 h-1 bg-[#8ab4f8] rounded-full opacity-60"></div>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {/* Other Files Section - Minimal */}
            {otherFiles.length > 0 && (
              <CommandGroup className="p-0">
                {otherFiles.map(file => (
                  <CommandItem
                    key={`other-${file.path}`}
                    value={`${file.name} ${file.path}`}
                    onSelect={() => handleFileSelect(file.path)}
                    className="px-4 py-2 flex items-center gap-3 cursor-pointer aria-selected:bg-[#2a2a2a] aria-selected:text-[#e0e0e0] hover:bg-[#2a2a2a] font-mono m-0 rounded-none border-none bg-transparent transition-colors duration-150"
                  >
                    <File size={16} className="text-[#666]" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#e0e0e0] truncate">{file.name}</div>
                      <div className="text-xs text-[#666] truncate">
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
