import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { Button } from "@/ui/button";
import Command, { CommandHeader, CommandInput, CommandList } from "@/ui/command";
import { SEARCH_TOGGLE_ICONS } from "@/ui/search";
import { cn } from "@/utils/cn";
import { getBaseName, getRelativePath } from "@/utils/path-helpers";
import { PREVIEW_DEBOUNCE_DELAY } from "../constants/limits";
import { useContentSearch } from "../hooks/use-content-search";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { ContentSearchResult } from "./content-search-result";
import { FilePreview } from "./file-preview";
const MAX_DISPLAYED_MATCHES = 500;

const ContentGlobalSearch = () => {
  const isVisible = useUIState((state) => state.isGlobalSearchVisible);
  const setIsVisible = useUIState((state) => state.setIsGlobalSearchVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const quickOpenPreview = useSettingsStore((state) => state.settings.quickOpenPreview);

  const inputRef = useRef<HTMLInputElement>(null);
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
    includeQuery,
    setIncludeQuery,
    excludeQuery,
    setExcludeQuery,
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
      const displayPath = getRelativePath(result.file_path, rootFolderPath);

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

  // Prepare data for keyboard navigation - convert matches to FileItem format
  const navigationItems = useMemo(() => {
    return flattenedMatches.map((item) => ({
      path: `${item.filePath}:${item.match.line_number}`,
      name: getBaseName(item.filePath, ""),
      isDir: false,
    }));
  }, [flattenedMatches]);

  // Keyboard navigation
  const { selectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible,
    allResults: navigationItems,
    onClose,
    onSelect: (path) => {
      const [filePath, lineStr] = path.split(":");
      const lineNumber = parseInt(lineStr, 10);
      handleFileClick(filePath, lineNumber);
    },
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

  const matchIndexMap = useMemo(() => {
    return new Map(navigationItems.map((item, index) => [item.path, index]));
  }, [navigationItems]);

  if (!isVisible) {
    return null;
  }

  const hasResults = results.length > 0;
  const totalMatches = results.reduce((sum, r) => sum + r.total_matches, 0);
  const displayedCount = flattenedMatches.length;
  const hasMore = totalMatches > displayedCount;

  const resultLabel =
    debouncedQuery && !isSearching
      ? `${displayedCount} ${displayedCount === 1 ? "result" : "results"}${hasMore ? ` (${totalMatches} total)` : ""}`
      : null;

  const searchOptionsButtons = [
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
  ];
  const selectedMatchKey =
    selectedIndex >= 0 && selectedIndex < navigationItems.length
      ? navigationItems[selectedIndex]?.path
      : null;

  return (
    <Command
      isVisible={isVisible}
      onClose={onClose}
      className={cn(
        "overflow-hidden",
        quickOpenPreview
          ? "h-[min(600px,calc(100dvh-128px))] w-[min(1200px,calc(100vw-32px))]"
          : "h-[min(600px,calc(100dvh-128px))] w-[min(800px,calc(100vw-32px))]",
      )}
    >
      <div data-global-search className="flex min-h-0 flex-1 flex-col">
        <CommandHeader onClose={onClose}>
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-3">
              <CommandInput
                ref={inputRef}
                value={query}
                onChange={setQuery}
                placeholder="Search in files..."
                className="ui-font"
              />
              {resultLabel ? (
                <span className="ui-font ui-text-xs shrink-0 text-text-lighter">{resultLabel}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {searchOptionsButtons.map((option) => (
                <Button
                  key={option.id}
                  type="button"
                  onClick={option.onToggle}
                  variant="ghost"
                  size="icon-xs"
                  className={cn(
                    "rounded-md border border-transparent text-text-lighter transition-colors",
                    option.active
                      ? "border-border/70 bg-hover text-text"
                      : "hover:border-border/70 hover:bg-hover hover:text-text",
                  )}
                  tooltip={option.label}
                  aria-label={option.label}
                  aria-pressed={option.active}
                >
                  {option.icon}
                </Button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <CommandInput
                value={includeQuery}
                onChange={setIncludeQuery}
                placeholder="Files to include"
                className="ui-font h-7 rounded-md border border-border/70 bg-primary-bg/65 px-2"
              />
              <CommandInput
                value={excludeQuery}
                onChange={setExcludeQuery}
                placeholder="Files to exclude"
                className="ui-font h-7 rounded-md border border-border/70 bg-primary-bg/65 px-2"
              />
            </div>
          </div>
        </CommandHeader>

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden",
              quickOpenPreview ? "border-border border-r" : "w-full",
            )}
          >
            <CommandList ref={scrollContainerRef}>
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
                <div className="ui-text-sm flex h-full items-center justify-center text-center text-error">
                  {error}
                </div>
              )}

              {hasResults && (
                <>
                  <div className="space-y-1">
                    {results.map((result) => (
                      <ContentSearchResult
                        key={result.file_path}
                        result={result}
                        rootFolderPath={rootFolderPath}
                        onFileClick={handleFileClick}
                        onFileHover={quickOpenPreview ? debouncedSetPreview : undefined}
                        selectedMatchKey={selectedMatchKey}
                        getMatchIndex={(lineNumber) =>
                          matchIndexMap.get(`${result.file_path}:${lineNumber}`)
                        }
                      />
                    ))}
                  </div>
                  {hasMore && (
                    <div className="ui-text-sm px-3 py-2 text-center text-text-lighter">
                      Showing first {displayedCount} of {totalMatches} results
                    </div>
                  )}
                </>
              )}
            </CommandList>
          </div>

          {quickOpenPreview && (
            <div className="w-[min(48%,600px)] shrink-0">
              <FilePreview filePath={previewFilePath} />
            </div>
          )}
        </div>
      </div>
    </Command>
  );
};

export default ContentGlobalSearch;
