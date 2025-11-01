import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { CommandInput } from "@/ui/command";
import { cn } from "@/utils/cn";
import { useContentSearch } from "../hooks/use-content-search";
import { FilePreview } from "./file-preview";
import { SearchMatchItem } from "./search-match-item";

const MAX_DISPLAYED_MATCHES = 500;

const ContentGlobalSearch = () => {
  const isVisible = useUIState((state) => state.isGlobalSearchVisible);
  const setIsVisible = useUIState((state) => state.setIsGlobalSearchVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const commandBarPreview = useSettingsStore((state) => state.settings.commandBarPreview);

  const inputRef = useRef<HTMLInputElement>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const { query, setQuery, debouncedQuery, results, isSearching, error, rootFolderPath } =
    useContentSearch(isVisible);

  const onClose = useCallback(() => {
    setIsVisible(false);
  }, [setIsVisible]);

  const handleFileClick = useCallback(
    (filePath: string, lineNumber?: number) => {
      handleFileSelect(filePath, false);
      onClose();

      // If line number is provided, jump to that line
      if (lineNumber) {
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("menu-go-to-line", {
              detail: { line: lineNumber },
            }),
          );
        }, 100);
      }
    },
    [handleFileSelect, onClose],
  );

  // Focus input when visible
  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible]);

  // Handle click outside
  useEffect(() => {
    if (!isVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-global-search]")) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isVisible, onClose]);

  // Handle Escape key
  useEffect(() => {
    if (!isVisible) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isVisible, onClose]);

  // Flatten results into individual match items for performance
  const flattenedMatches = useMemo(() => {
    const matches: Array<{
      filePath: string;
      displayPath: string;
      match: {
        line_number: number;
        line_content: string;
        column_start: number;
        column_end: number;
      };
    }> = [];

    for (const result of results) {
      const displayPath = rootFolderPath
        ? result.file_path.replace(rootFolderPath, "").replace(/^\//, "")
        : result.file_path;

      for (const match of result.matches) {
        matches.push({
          filePath: result.file_path,
          displayPath,
          match,
        });

        // Limit total matches for performance
        if (matches.length >= MAX_DISPLAYED_MATCHES) {
          return matches;
        }
      }
    }

    return matches;
  }, [results, rootFolderPath]);

  if (!isVisible) {
    return null;
  }

  const hasResults = results.length > 0;
  const totalMatches = results.reduce((sum, r) => sum + r.total_matches, 0);
  const displayedCount = flattenedMatches.length;
  const hasMore = totalMatches > displayedCount;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16">
      {/* Backdrop */}
      <button
        type="button"
        className="absolute inset-0 cursor-default bg-black/20"
        onClick={onClose}
        aria-label="Close global search"
        tabIndex={-1}
      />

      <div
        data-global-search
        className={cn(
          "relative flex overflow-hidden rounded-md border border-border bg-primary-bg shadow-2xl",
          commandBarPreview ? "h-[600px] w-[1200px]" : "h-[600px] w-[800px]",
        )}
      >
        {/* Left Column - Search Results */}
        <div
          className={cn(
            "flex flex-col",
            commandBarPreview ? "w-[600px] border-border border-r" : "w-full",
          )}
        >
          {/* Header */}
          <div className="border-border border-b">
            <div className="flex items-center gap-3 px-4 py-3">
              <CommandInput
                ref={inputRef}
                value={query}
                onChange={setQuery}
                placeholder="Search in files..."
                className="font-mono"
              />
              {hasResults && (
                <span className="flex-shrink-0 text-[10px] text-text-lighter">
                  {displayedCount} {displayedCount === 1 ? "result" : "results"}
                  {hasMore && ` (${totalMatches} total)`}
                </span>
              )}
              <button onClick={onClose} className="rounded p-0.5 transition-colors hover:bg-hover">
                <X size={12} className="text-text-lighter" />
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="custom-scrollbar-thin flex-1 overflow-y-auto p-2">
            {!debouncedQuery && (
              <div className="flex h-full items-center justify-center text-center text-text-lighter text-xs">
                Type to search across all files in your project
              </div>
            )}

            {debouncedQuery && isSearching && (
              <div className="flex h-full items-center justify-center text-center text-text-lighter text-xs">
                Searching...
              </div>
            )}

            {debouncedQuery && !isSearching && !hasResults && !error && (
              <div className="flex h-full items-center justify-center text-center text-text-lighter text-xs">
                No results found for "{debouncedQuery}"
              </div>
            )}

            {error && (
              <div className="flex h-full items-center justify-center text-center text-red-500 text-xs">
                {error}
              </div>
            )}

            {hasResults && (
              <div>
                {flattenedMatches.map((item, idx) => (
                  <SearchMatchItem
                    key={`${item.filePath}-${item.match.line_number}-${idx}`}
                    filePath={item.filePath}
                    displayPath={item.displayPath}
                    match={item.match}
                    onClick={() => handleFileClick(item.filePath, item.match.line_number)}
                    onHover={
                      commandBarPreview ? () => setPreviewFilePath(item.filePath) : undefined
                    }
                  />
                ))}
                {hasMore && (
                  <div className="px-3 py-2 text-center text-[10px] text-text-lighter">
                    Showing first {displayedCount} of {totalMatches} results
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column - Preview Pane */}
        {commandBarPreview && (
          <div className="w-[600px] flex-shrink-0">
            <FilePreview filePath={previewFilePath} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentGlobalSearch;
