import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlassIcon as MagnifyingGlass } from "@phosphor-icons/react";
import {
  FileNavigatorSidebar,
  type FileNavigatorItem,
  type FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { Button } from "@/ui/button";
import { CommandInput } from "@/ui/command";
import { SEARCH_TOGGLE_ICONS, SearchReplaceRow, SearchReplaceToggle } from "@/ui/search";
import { TabsList } from "@/ui/tabs";
import { cn } from "@/utils/cn";
import {
  CONTENT_SEARCH_INITIAL_RENDER_LIMIT,
  CONTENT_SEARCH_RENDER_INCREMENT,
} from "../constants/limits";
import { useContentSearch } from "../hooks/use-content-search";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { buildSearchExcerpts } from "../utils/search-excerpts";
import { replaceAllInSources, replaceNextInSource } from "../utils/source-replace";
import { SearchExcerptResults } from "./search-excerpt-results";

const MAX_MARKERS = 160;
const DEFAULT_CONTEXT_LINES = 2;
const EXPANDED_CONTEXT_LINES = 7;

interface SearchNavigationItem {
  path: string;
  name: string;
  isDir: false;
}

interface SearchMatchIndexEntry {
  excerptIndex: number;
  filePath: string;
  targetLine: number;
  targetColumn: number;
}

const isAbsolutePath = (filePath: string) => {
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
};

const getNavigatorPath = (filePath: string, displayPath: string, fileName: string) => {
  if (displayPath && displayPath !== filePath) return displayPath;
  if (isAbsolutePath(filePath)) return fileName;
  return displayPath || fileName;
};

const GlobalSearchBuffer = () => {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [isReplaceVisible, setIsReplaceVisible] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [canScrollResults, setCanScrollResults] = useState(false);
  const [visibleMatchLimit, setVisibleMatchLimit] = useState(CONTENT_SEARCH_INITIAL_RENDER_LIMIT);
  const [fileNavigatorViewMode, setFileNavigatorViewMode] = useState<FileNavigatorViewMode>("tree");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [contextLinesByFile, setContextLinesByFile] = useState<Record<string, number>>({});
  const [sourceContentByPath, setSourceContentByPath] = useState<Record<string, string>>({});
  const {
    query,
    setQuery,
    debouncedQuery,
    results,
    isSearching,
    isLoadingMore,
    error,
    hasMoreResults,
    searchedFiles,
    searchableFiles,
    isIndexing,
    indexedFiles,
    scannedFiles,
    rootFolderPath,
    searchOptions,
    setSearchOption,
    includeQuery,
    setIncludeQuery,
    excludeQuery,
    setExcludeQuery,
    refreshSearch,
    loadMoreResults: loadMoreBackendResults,
  } = useContentSearch();

  const handleFileClick = useCallback(
    (filePath: string, lineNumber?: number, columnNumber?: number) => {
      void handleFileSelect(filePath, false, lineNumber, columnNumber);
    },
    [handleFileSelect],
  );

  const excerpts = useMemo(
    () =>
      buildSearchExcerpts(results, rootFolderPath, visibleMatchLimit, {
        contextLinesByFile,
        sourceContentByPath,
      }),
    [contextLinesByFile, results, rootFolderPath, sourceContentByPath, visibleMatchLimit],
  );

  const {
    fileNavigatorItems,
    fileNavigatorKeySet,
    excerptIndexByFilePath,
    navigationItems,
    matchIndex,
  } = useMemo(() => {
    const nextFileNavigatorItems: FileNavigatorItem[] = [];
    const nextFileNavigatorKeySet = new Set<string>();
    const nextExcerptIndexByFilePath = new Map<string, number>();
    const nextNavigationItems: SearchNavigationItem[] = [];
    const nextMatchIndex = new Map<string, SearchMatchIndexEntry>();

    for (let excerptIndex = 0; excerptIndex < excerpts.length; excerptIndex++) {
      const excerpt = excerpts[excerptIndex];
      if (!excerpt) continue;

      nextFileNavigatorKeySet.add(excerpt.filePath);
      nextExcerptIndexByFilePath.set(excerpt.filePath, excerptIndex);

      const navigatorPath = getNavigatorPath(
        excerpt.filePath,
        excerpt.displayPath,
        excerpt.fileName,
      );

      nextFileNavigatorItems.push({
        key: excerpt.filePath,
        path: navigatorPath,
        label: navigatorPath,
        iconPath: excerpt.filePath,
        metadata: [
          {
            label: excerpt.matchCount,
            className: "text-text-lighter",
          },
        ],
      });

      for (const match of excerpt.matches) {
        nextNavigationItems.push({
          path: match.itemKey,
          name: excerpt.fileName,
          isDir: false,
        });
        nextMatchIndex.set(match.itemKey, {
          excerptIndex,
          filePath: excerpt.filePath,
          targetLine: match.targetLine,
          targetColumn: match.targetColumn,
        });
      }
    }

    return {
      fileNavigatorItems: nextFileNavigatorItems,
      fileNavigatorKeySet: nextFileNavigatorKeySet,
      excerptIndexByFilePath: nextExcerptIndexByFilePath,
      navigationItems: nextNavigationItems,
      matchIndex: nextMatchIndex,
    };
  }, [excerpts]);

  const { selectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible: true,
    allResults: navigationItems,
    onClose: () => {},
    onSelect: (path) => {
      const match = matchIndex.get(path);
      if (match) {
        handleFileClick(match.filePath, match.targetLine, match.targetColumn);
      }
    },
    scrollToIndex: (index) => {
      const itemKey = navigationItems[index]?.path;
      const match = itemKey ? matchIndex.get(itemKey) : null;
      const container = scrollContainerRef.current;
      if (!match || !container) return;

      const selectedElement = container.querySelector(
        `[data-excerpt-index="${match.excerptIndex}"]`,
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    },
  });

  const selectedItemKey =
    selectedIndex >= 0 && selectedIndex < navigationItems.length
      ? (navigationItems[selectedIndex]?.path ?? null)
      : null;
  const selectedMatch =
    selectedItemKey && matchIndex.has(selectedItemKey) ? matchIndex.get(selectedItemKey) : null;
  const selectedFileNavigatorKey =
    selectedFilePath && fileNavigatorKeySet.has(selectedFilePath)
      ? selectedFilePath
      : (selectedMatch?.filePath ?? fileNavigatorItems[0]?.key ?? null);

  const handleFileNavigatorSelect = useCallback(
    (filePath: string) => {
      setSelectedFilePath(filePath);
      const excerptIndex = excerptIndexByFilePath.get(filePath) ?? -1;
      if (excerptIndex < 0) return;

      const selectedElement = scrollContainerRef.current?.querySelector(
        `[data-excerpt-index="${excerptIndex}"]`,
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    },
    [excerptIndexByFilePath, scrollContainerRef],
  );

  const filePathsWithResults = useMemo(() => {
    const paths = new Set<string>();
    for (const result of results) {
      paths.add(result.file_path);
    }
    return Array.from(paths);
  }, [results]);
  const markerItems = useMemo(() => {
    if (navigationItems.length <= MAX_MARKERS) {
      return navigationItems.map((item, index) => ({ item, markerIndex: index }));
    }

    const step = Math.ceil(navigationItems.length / MAX_MARKERS);
    const items: Array<{ item: (typeof navigationItems)[number]; markerIndex: number }> = [];

    for (let markerIndex = 0; markerIndex < navigationItems.length; markerIndex += step) {
      const item = navigationItems[markerIndex];
      if (item) {
        items.push({ item, markerIndex });
      }
    }

    if (
      selectedIndex >= 0 &&
      selectedIndex < navigationItems.length &&
      selectedIndex % step !== 0
    ) {
      const selectedItem = navigationItems[selectedIndex];
      if (selectedItem) {
        items.push({ item: selectedItem, markerIndex: selectedIndex });
        items.sort((a, b) => a.markerIndex - b.markerIndex);
      }
    }

    return items;
  }, [navigationItems, selectedIndex]);

  const handleExpandContext = useCallback(async (filePath: string) => {
    const content = await readFileContent(filePath);
    setSourceContentByPath((prev) => ({ ...prev, [filePath]: content }));
    setContextLinesByFile((prev) => ({
      ...prev,
      [filePath]: Math.max(prev[filePath] ?? DEFAULT_CONTEXT_LINES, EXPANDED_CONTEXT_LINES),
    }));
  }, []);

  const handleCollapseContext = useCallback((filePath: string) => {
    setContextLinesByFile((prev) => {
      const next = { ...prev };
      delete next[filePath];
      return next;
    });
  }, []);

  const isContextExpanded = useCallback(
    (filePath: string) =>
      (contextLinesByFile[filePath] ?? DEFAULT_CONTEXT_LINES) > DEFAULT_CONTEXT_LINES,
    [contextLinesByFile],
  );

  const replaceNext = useCallback(async () => {
    if (!selectedMatch || !debouncedQuery) return;

    const didReplace = await replaceNextInSource(
      {
        filePath: selectedMatch.filePath,
        line: selectedMatch.targetLine,
        column: selectedMatch.targetColumn,
      },
      debouncedQuery,
      replaceQuery,
      searchOptions,
    );

    if (didReplace) {
      await refreshSearch();
    }
  }, [debouncedQuery, refreshSearch, replaceQuery, searchOptions, selectedMatch]);

  const replaceAll = useCallback(async () => {
    if (!debouncedQuery || filePathsWithResults.length === 0) return;

    const count = await replaceAllInSources(
      filePathsWithResults,
      debouncedQuery,
      replaceQuery,
      searchOptions,
    );

    if (count > 0) {
      await refreshSearch();
    }
  }, [debouncedQuery, filePathsWithResults, refreshSearch, replaceQuery, searchOptions]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setVisibleMatchLimit(CONTENT_SEARCH_INITIAL_RENDER_LIMIT);
  }, [debouncedQuery, includeQuery, excludeQuery, searchOptions]);

  useEffect(() => {
    if (!selectedMatch?.filePath) return;
    setSelectedFilePath(selectedMatch.filePath);
  }, [selectedMatch?.filePath]);

  useEffect(() => {
    if (fileNavigatorItems.length === 0) {
      setSelectedFilePath(null);
      return;
    }

    setSelectedFilePath((current) =>
      current && fileNavigatorKeySet.has(current) ? current : (fileNavigatorItems[0]?.key ?? null),
    );
  }, [fileNavigatorItems, fileNavigatorKeySet]);

  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();
  const isSearchPending = trimmedQuery.length > 0 && trimmedQuery !== trimmedDebouncedQuery;
  const showBusy =
    trimmedQuery.length > 0 && (isSearching || isSearchPending || isIndexing || isLoadingMore);
  const hasResults = results.length > 0;
  const totalMatches = useMemo(
    () => results.reduce((sum, result) => sum + result.total_matches, 0),
    [results],
  );
  const displayedCount = navigationItems.length;
  const hasMoreRenderedMatches = totalMatches > displayedCount;
  const hasMore = hasMoreRenderedMatches || hasMoreResults;
  const showMarkerRail = hasResults && canScrollResults && markerItems.length > 1;
  const loadMoreResults = useCallback(() => {
    if (hasMoreRenderedMatches) {
      setVisibleMatchLimit((limit) =>
        Math.min(limit + CONTENT_SEARCH_RENDER_INCREMENT, totalMatches),
      );
      return;
    }

    if (hasMoreResults && !isLoadingMore) {
      void loadMoreBackendResults();
    }
  }, [hasMoreRenderedMatches, hasMoreResults, isLoadingMore, loadMoreBackendResults, totalMatches]);
  const busyLabel = useMemo(() => {
    if (isIndexing) {
      return scannedFiles > 0 ? `Indexing ${scannedFiles} files` : "Indexing files";
    }

    if (isSearchPending) {
      return "Preparing search";
    }

    if (isSearching) {
      if (searchableFiles > 0) {
        return `Searching ${Math.min(searchedFiles, searchableFiles)}/${searchableFiles} files`;
      }

      if (indexedFiles > 0) {
        return `Searching ${indexedFiles} files`;
      }

      return "Searching files";
    }

    if (isLoadingMore) {
      return "Loading more results";
    }

    return null;
  }, [
    indexedFiles,
    isIndexing,
    isLoadingMore,
    isSearchPending,
    isSearching,
    scannedFiles,
    searchableFiles,
    searchedFiles,
  ]);
  const resultLabel =
    busyLabel ??
    (trimmedDebouncedQuery && !showBusy
      ? `${displayedCount} ${displayedCount === 1 ? "result" : "results"}${hasMore ? ` (${hasMoreResults ? `${totalMatches}+` : totalMatches} total)` : ""}`
      : null);
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
  const canReplace = Boolean(debouncedQuery && displayedCount > 0);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const scrollContainer = scrollContainerRef.current;
    if (!sentinel || !scrollContainer || !hasMore || showBusy) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          loadMoreResults();
        }
      },
      {
        root: scrollContainer,
        rootMargin: "640px 0px",
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMoreResults, scrollContainerRef, showBusy]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer || !hasResults || showBusy) {
      setCanScrollResults(false);
      return;
    }

    const updateCanScroll = () => {
      setCanScrollResults(scrollContainer.scrollHeight > scrollContainer.clientHeight + 1);
    };

    const frame = requestAnimationFrame(updateCanScroll);
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateCanScroll);
    resizeObserver?.observe(scrollContainer);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [displayedCount, hasResults, scrollContainerRef, showBusy, totalMatches]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-border/70 border-b bg-secondary-bg/55 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <SearchReplaceToggle
            isExpanded={isReplaceVisible}
            onToggle={() => setIsReplaceVisible((visible) => !visible)}
            expandedLabel="Hide details"
            collapsedLabel="Show details"
          />
          <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border/70 bg-primary-bg/65 px-2">
            <MagnifyingGlass className="size-4 shrink-0 text-text-lighter" weight="duotone" />
            <CommandInput
              ref={inputRef}
              value={query}
              onChange={setQuery}
              placeholder="Search in files..."
              className="ui-font min-w-0"
            />
          </div>
          <TabsList variant="segmented" className="shrink-0">
            {searchOptionsButtons.map((option) => (
              <Button
                key={option.id}
                type="button"
                onClick={option.onToggle}
                variant="ghost"
                className={cn(
                  "h-full w-7 rounded-none border-0 text-text-lighter hover:bg-hover/60 hover:text-text focus-visible:rounded-none",
                  option.active && "bg-hover/80 text-text",
                )}
                tooltip={option.label}
                aria-label={option.label}
                aria-pressed={option.active}
                compact
              >
                {option.icon}
              </Button>
            ))}
          </TabsList>
          {resultLabel ? (
            <span className="ui-font ui-text-base shrink-0 rounded-full border border-border/60 bg-primary-bg/65 px-2 py-1 text-text-lighter">
              {resultLabel}
            </span>
          ) : null}
        </div>
        {isReplaceVisible ? (
          <div className="mt-2 space-y-2">
            <SearchReplaceRow
              value={replaceQuery}
              onChange={setReplaceQuery}
              inputRef={replaceInputRef}
              onReplace={replaceNext}
              onReplaceAll={replaceAll}
              canReplace={canReplace}
            />
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
        ) : null}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-primary-bg">
        {hasResults ? (
          <div className="flex h-full min-h-0 overflow-hidden">
            <FileNavigatorSidebar
              items={fileNavigatorItems}
              selectedKey={selectedFileNavigatorKey}
              onSelect={handleFileNavigatorSelect}
              ariaLabel="Search result files"
              viewMode={fileNavigatorViewMode}
              onViewModeChange={setFileNavigatorViewMode}
              searchMode="fuzzy"
            />
            <div
              ref={scrollContainerRef}
              data-editor-outer-scroll
              className="custom-scrollbar-thin relative min-h-0 flex-1 overflow-y-auto bg-primary-bg"
            >
              {showBusy && busyLabel ? (
                <div className="ui-text-base flex min-h-[120px] items-center justify-center text-center text-text-lighter">
                  {busyLabel}
                </div>
              ) : null}

              <div className={cn(showMarkerRail && "pr-5")}>
                <SearchExcerptResults
                  excerpts={excerpts}
                  selectedItemKey={selectedItemKey}
                  onOpen={handleFileClick}
                  onExpandContext={handleExpandContext}
                  onCollapseContext={handleCollapseContext}
                  isContextExpanded={isContextExpanded}
                />
              </div>
              {showMarkerRail ? (
                <div className="pointer-events-none absolute top-2 right-3 bottom-2 w-2 rounded-full bg-secondary-bg/30">
                  {markerItems.map(({ item, markerIndex }) => {
                    const match = matchIndex.get(item.path);
                    if (!match) return null;
                    const markerPercent =
                      navigationItems.length <= 1
                        ? 0
                        : (markerIndex / (navigationItems.length - 1)) * 100;

                    return (
                      <button
                        key={item.path}
                        type="button"
                        aria-label={`Result ${markerIndex + 1}`}
                        className={cn(
                          "pointer-events-auto absolute right-0 size-1 rounded-full bg-text-lighter/35 hover:bg-accent",
                          selectedItemKey === item.path && "bg-accent",
                        )}
                        style={{
                          top: `calc(${markerPercent}% - 2px)`,
                        }}
                        onClick={() => {
                          const selectedElement = scrollContainerRef.current?.querySelector(
                            `[data-excerpt-index="${match.excerptIndex}"]`,
                          ) as HTMLElement | null;
                          selectedElement?.scrollIntoView({
                            behavior: "smooth",
                            block: "nearest",
                          });
                        }}
                      />
                    );
                  })}
                </div>
              ) : null}
              {hasMore ? (
                <div
                  ref={loadMoreRef}
                  className="ui-text-base px-3 py-3 text-center text-text-lighter"
                >
                  {isLoadingMore
                    ? "Loading more results"
                    : `Showing ${displayedCount} of ${hasMoreResults ? `${totalMatches}+` : totalMatches} results`}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div
            ref={scrollContainerRef}
            data-editor-outer-scroll
            className="custom-scrollbar-thin h-full overflow-y-auto bg-primary-bg"
          >
            {!debouncedQuery ? (
              <div className="flex h-full min-h-[320px] items-center justify-center px-6">
                <div className="flex max-w-md flex-col items-center text-center">
                  <div className="mb-3 flex size-11 items-center justify-center rounded-lg border border-border bg-secondary-bg text-text-lighter">
                    <MagnifyingGlass className="size-6" weight="duotone" />
                  </div>
                  <div className="ui-text-base font-medium text-text">
                    Search across your project
                  </div>
                  <div className="ui-text-base mt-1 text-text-lighter">
                    Type a query to see matching files and lines in a project-wide result buffer.
                  </div>
                </div>
              </div>
            ) : null}

            {showBusy && busyLabel ? (
              <div className="ui-text-base flex min-h-[240px] items-center justify-center text-center text-text-lighter">
                {busyLabel}
              </div>
            ) : null}

            {trimmedDebouncedQuery && !showBusy && !error ? (
              <div className="ui-text-base flex min-h-[240px] items-center justify-center text-center text-text-lighter">
                No results found for "{debouncedQuery}"
              </div>
            ) : null}

            {error ? (
              <div className="ui-text-base flex min-h-[240px] items-center justify-center text-center text-error">
                {error}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearchBuffer;
