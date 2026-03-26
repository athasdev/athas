import { useVirtualizer } from "@tanstack/react-virtual";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import { SEARCH_TOGGLE_ICONS, SearchInput } from "@/ui/search";
import { cn } from "@/utils/cn";
import { PREVIEW_DEBOUNCE_DELAY } from "../constants/limits";
import { useContentSearch } from "../hooks/use-content-search";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { FilePreview } from "./file-preview";
import { SearchMatchItem } from "./search-match-item";

const MAX_DISPLAYED_MATCHES = 500;
const ESTIMATED_ITEM_HEIGHT = 32;

const ContentGlobalSearch = () => {
  const isVisible = useUIState((state) => state.isGlobalSearchVisible);
  const setIsVisible = useUIState((state) => state.setIsGlobalSearchVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const quickOpenPreview = useSettingsStore((state) => state.settings.quickOpenPreview);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const {
    query,
    setQuery,
    debouncedQuery,
    results,
    isSearching,
    error,
    rootFolderPath,
    searchOptions,
    setSearchOption,
  } = useContentSearch(isVisible);

  const debouncedSetPreview = useDebouncedCallback(
    (path: string | null) => setPreviewFilePath(path),
    PREVIEW_DEBOUNCE_DELAY,
  );

  const onClose = useCallback(() => {
    setIsVisible(false);
  }, [setIsVisible]);

  const handleFileClick = useCallback(
    (filePath: string, lineNumber?: number) => {
      onClose();
      void handleFileSelect(filePath, false, lineNumber);
    },
    [handleFileSelect, onClose],
  );

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

        if (matches.length >= MAX_DISPLAYED_MATCHES) {
          return matches;
        }
      }
    }

    return matches;
  }, [results, rootFolderPath]);

  // Virtualizer
  const virtualizer = useVirtualizer({
    count: flattenedMatches.length,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    getScrollElement: () => scrollContainerRef.current,
    overscan: 10,
  });

  // Prepare data for keyboard navigation - convert matches to FileItem format
  const navigationItems = useMemo(() => {
    return flattenedMatches.map((item) => ({
      path: `${item.filePath}:${item.match.line_number}`,
      name: item.filePath.split("/").pop() || "",
      isDir: false,
    }));
  }, [flattenedMatches]);

  const scrollToIndex = useCallback(
    (index: number) => {
      virtualizer.scrollToIndex(index, { align: "auto" });
    },
    [virtualizer],
  );

  // Keyboard navigation
  const { selectedIndex } = useKeyboardNavigation({
    isVisible,
    allResults: navigationItems,
    onClose,
    onSelect: (path) => {
      const [filePath, lineStr] = path.split(":");
      const lineNumber = parseInt(lineStr, 10);
      handleFileClick(filePath, lineNumber);
    },
    scrollToIndex,
  });

  // Update preview when selected index changes
  useEffect(() => {
    if (quickOpenPreview && flattenedMatches.length > 0 && selectedIndex >= 0) {
      const selectedMatch = flattenedMatches[selectedIndex];
      if (selectedMatch) {
        debouncedSetPreview(selectedMatch.filePath);
      }
    }
  }, [selectedIndex, flattenedMatches, quickOpenPreview, debouncedSetPreview]);

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="absolute inset-0 cursor-default rounded-none bg-transparent hover:bg-transparent"
        onClick={onClose}
        aria-label="Close global search"
        tabIndex={-1}
      />

      <div
        data-global-search
        className={cn(
          "relative flex overflow-hidden rounded-md border border-border bg-primary-bg shadow-2xl",
          quickOpenPreview ? "h-[600px] w-[1200px]" : "h-[600px] w-[800px]",
        )}
      >
        {/* Left Column - Search Results */}
        <div
          className={cn(
            "flex flex-col",
            quickOpenPreview ? "w-[600px] border-border border-r" : "w-full",
          )}
        >
          {/* Header */}
          <div className="border-border border-b">
            <div className="flex items-center gap-2 px-3 py-2">
              <SearchInput
                inputRef={inputRef}
                value={query}
                onChange={setQuery}
                placeholder="Search in files..."
                matchLabel={
                  hasResults
                    ? `${displayedCount} ${displayedCount === 1 ? "result" : "results"}${hasMore ? ` (${totalMatches} total)` : ""}`
                    : null
                }
                options={[
                  {
                    id: "case-sensitive",
                    label: "Match case",
                    icon: SEARCH_TOGGLE_ICONS.caseSensitive,
                    active: searchOptions.caseSensitive,
                    onToggle: () => setSearchOption("caseSensitive", !searchOptions.caseSensitive),
                  },
                  {
                    id: "whole-word",
                    label: "Match whole word",
                    icon: SEARCH_TOGGLE_ICONS.wholeWord,
                    active: searchOptions.wholeWord,
                    onToggle: () => setSearchOption("wholeWord", !searchOptions.wholeWord),
                  },
                  {
                    id: "regex",
                    label: "Use regular expression",
                    icon: SEARCH_TOGGLE_ICONS.regex,
                    active: searchOptions.useRegex,
                    onToggle: () => setSearchOption("useRegex", !searchOptions.useRegex),
                  },
                ]}
              />
              <Button onClick={onClose} variant="ghost" size="icon-xs" className="shrink-0 rounded">
                <X className="text-text-lighter" />
              </Button>
            </div>
          </div>

          {/* Results */}
          <div
            ref={scrollContainerRef}
            className="custom-scrollbar-thin flex-1 overflow-y-auto p-2"
          >
            {!debouncedQuery && (
              <div className="ui-text-sm flex h-full items-center justify-center text-center text-text-lighter">
                Type to search across all files in your project
              </div>
            )}

            {debouncedQuery && isSearching && (
              <div className="ui-text-sm flex h-full items-center justify-center text-center text-text-lighter">
                Searching...
              </div>
            )}

            {debouncedQuery && !isSearching && !hasResults && !error && (
              <div className="ui-text-sm flex h-full items-center justify-center text-center text-text-lighter">
                No results found for "{debouncedQuery}"
              </div>
            )}

            {error && (
              <div className="ui-text-sm flex h-full items-center justify-center text-center text-red-500">
                {error}
              </div>
            )}

            {hasResults && (
              <>
                <div
                  style={{
                    height: virtualizer.getTotalSize(),
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {virtualizer.getVirtualItems().map((virtualRow) => {
                    const item = flattenedMatches[virtualRow.index];
                    return (
                      <SearchMatchItem
                        key={`${item.filePath}-${item.match.line_number}-${virtualRow.index}`}
                        index={virtualRow.index}
                        isSelected={virtualRow.index === selectedIndex}
                        filePath={item.filePath}
                        displayPath={item.displayPath}
                        match={item.match}
                        onSelect={handleFileClick}
                        onPreview={quickOpenPreview ? debouncedSetPreview : undefined}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                      />
                    );
                  })}
                </div>
                {hasMore && (
                  <div className="ui-text-sm px-3 py-2 text-center text-text-lighter">
                    Showing first {displayedCount} of {totalMatches} results
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right Column - Preview Pane */}
        {quickOpenPreview && (
          <div className="w-[600px] shrink-0">
            <FilePreview filePath={previewFilePath} />
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentGlobalSearch;
