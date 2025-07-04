import { useState, useEffect } from "react";
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

const CommandBar = ({
  isVisible,
  onClose,
  files,
  onFileSelect,
  rootFolderPath,
}: CommandBarProps) => {
  const [query, setQuery] = useState("");

  // Reset query when command bar becomes visible
  useEffect(() => {
    if (isVisible) {
      setQuery("");
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

  // Helper function to get relative path
  const getRelativePath = (fullPath: string): string => {
    if (!rootFolderPath) return fullPath;

    // Normalize paths to handle different path separators
    const normalizedFullPath = fullPath.replace(/\\/g, "/");
    const normalizedRootPath = rootFolderPath.replace(/\\/g, "/");

    if (normalizedFullPath.startsWith(normalizedRootPath)) {
      const relativePath = normalizedFullPath.substring(normalizedRootPath.length);
      // Remove leading slash if present
      return relativePath.startsWith("/") ? relativePath.substring(1) : relativePath;
    }

    return fullPath;
  };

  // Get all files (filter out directories)
  const getAllFiles = (entries: Array<{ name: string; path: string; isDir: boolean }>) => {
    return entries.filter(entry => !entry.isDir);
  };

  const handleFileSelect = (path: string) => {
    onFileSelect(path);
    onClose();
  };

  // Get filtered files
  const allFiles = getAllFiles(files);
  const filteredFiles = allFiles
    .filter(
      file =>
        file.name.toLowerCase().includes(query.toLowerCase())
        || file.path.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 20); // Limit to 20 results

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

            {filteredFiles.length > 0 && (
              <CommandGroup className="p-0">
                {filteredFiles.map(file => (
                  <CommandItem
                    key={file.path}
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
