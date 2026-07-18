import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type {
  FileNavigatorItem,
  FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { getBaseName, getRelativePath } from "@/utils/path-helpers";
import {
  CONTENT_SEARCH_INITIAL_RENDER_LIMIT,
  CONTENT_SEARCH_RENDER_INCREMENT,
} from "../constants/limits";
import { useContentSearch } from "../hooks/use-content-search";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { buildSearchExcerpts } from "../utils/search-excerpts";
import { replaceAllInSources, replaceNextInSource } from "../utils/source-replace";
import { GlobalSearchResults } from "./global-search-results";
import { GlobalSearchState } from "./global-search-state";
import { GlobalSearchToolbar } from "./global-search-toolbar";

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
  const pendingFileNavigatorPathRef = useRef<string | null>(null);
  const [isReplaceVisible, setIsReplaceVisible] = useState(false);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [visibleMatchLimit, setVisibleMatchLimit] = useState(CONTENT_SEARCH_INITIAL_RENDER_LIMIT);
  const [fileNavigatorViewMode, setFileNavigatorViewMode] = useState<FileNavigatorViewMode>("tree");
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [prioritizedFilePath, setPrioritizedFilePath] = useState<string | null>(null);
  const [contextLinesByFile, setContextLinesByFile] = useState<Record<string, number>>({});
  const [sourceContentByPath, setSourceContentByPath] = useState<Record<string, string>>({});
  const [replaceOperation, setReplaceOperation] = useState<"next" | "all" | null>(null);
  const sourceContentByPathRef = useRef(sourceContentByPath);
  const activeSearchKeyRef = useRef("");
  sourceContentByPathRef.current = sourceContentByPath;
  const {
    query,
    setQuery,
    debouncedQuery,
    results,
    isSearching,
    isSearchPending,
    isLoadingMore,
    error,
    searchWarning,
    hasMoreResults,
    searchedFiles,
    searchableFiles,
    isIndexing,
    indexedFiles,
    scannedFiles,
    rootFolderPath,
    availability,
    searchKey,
    searchOptions,
    setSearchOption,
    includeQuery,
    setIncludeQuery,
    excludeQuery,
    setExcludeQuery,
    refreshSearch,
    loadMoreResults: loadMoreBackendResults,
  } = useContentSearch();
  activeSearchKeyRef.current = searchKey;
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();
  const isResultNavigationDisabled = isSearchPending || isSearching || isIndexing;

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
        prioritizedFilePath,
      }),
    [
      contextLinesByFile,
      prioritizedFilePath,
      results,
      rootFolderPath,
      sourceContentByPath,
      visibleMatchLimit,
    ],
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

    for (const result of results) {
      const displayPath = getRelativePath(result.file_path, rootFolderPath);
      const fileName = getBaseName(result.file_path, result.file_path);
      const navigatorPath = getNavigatorPath(result.file_path, displayPath, fileName);

      nextFileNavigatorKeySet.add(result.file_path);
      nextFileNavigatorItems.push({
        key: result.file_path,
        path: navigatorPath,
        label: navigatorPath,
        iconPath: result.file_path,
        metadata: [
          {
            label: result.total_matches,
            className: "text-text-lighter",
          },
        ],
      });
    }

    for (let excerptIndex = 0; excerptIndex < excerpts.length; excerptIndex++) {
      const excerpt = excerpts[excerptIndex];
      if (!excerpt) continue;

      nextExcerptIndexByFilePath.set(excerpt.filePath, excerptIndex);

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
  }, [excerpts, results, rootFolderPath]);

  const { selectedIndex, scrollContainerRef, handleKeyDown } = useKeyboardNavigation({
    isVisible: true,
    allResults: isResultNavigationDisabled ? [] : navigationItems,
    onClose: () => {
      if (query) {
        setQuery("");
      } else {
        inputRef.current?.blur();
      }
    },
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
        behavior: "auto",
        block: "nearest",
      });
    },
    listenGlobally: false,
    resetKey: searchKey,
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
      setPrioritizedFilePath(filePath);
      pendingFileNavigatorPathRef.current = filePath;
      const excerptIndex = excerptIndexByFilePath.get(filePath) ?? -1;
      if (excerptIndex < 0) return;

      pendingFileNavigatorPathRef.current = null;

      const selectedElement = scrollContainerRef.current?.querySelector(
        `[data-excerpt-index="${excerptIndex}"]`,
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
    },
    [excerptIndexByFilePath, scrollContainerRef],
  );

  useEffect(() => {
    const filePath = pendingFileNavigatorPathRef.current;
    if (!filePath) return;

    const excerptIndex = excerptIndexByFilePath.get(filePath) ?? -1;
    if (excerptIndex < 0) return;

    pendingFileNavigatorPathRef.current = null;
    const frame = requestAnimationFrame(() => {
      const selectedElement = scrollContainerRef.current?.querySelector(
        `[data-excerpt-index="${excerptIndex}"]`,
      ) as HTMLElement | null;
      selectedElement?.scrollIntoView({ behavior: "auto", block: "start" });
    });

    return () => cancelAnimationFrame(frame);
  }, [excerptIndexByFilePath, scrollContainerRef]);

  const filePathsWithResults = useMemo(() => {
    const paths = new Set<string>();
    for (const result of results) {
      paths.add(result.file_path);
    }
    return Array.from(paths);
  }, [results]);
  const handleExpandContext = useCallback(
    async (filePath: string) => {
      const expansionSearchKey = searchKey;

      try {
        let content = sourceContentByPathRef.current[filePath];
        if (content === undefined) {
          content = await readFileContent(filePath);
        }
        if (expansionSearchKey !== activeSearchKeyRef.current) return;

        sourceContentByPathRef.current = {
          ...sourceContentByPathRef.current,
          [filePath]: content,
        };
        setSourceContentByPath(sourceContentByPathRef.current);
        setContextLinesByFile((previous) => ({
          ...previous,
          [filePath]: Math.max(previous[filePath] ?? DEFAULT_CONTEXT_LINES, EXPANDED_CONTEXT_LINES),
        }));
      } catch (contextError) {
        toast.error(
          contextError instanceof Error ? contextError.message : "Failed to expand search context",
        );
      }
    },
    [searchKey],
  );

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
    if (!selectedMatch || !debouncedQuery || replaceOperation) return;

    setReplaceOperation("next");
    try {
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
    } catch (replaceError) {
      toast.error(
        replaceError instanceof Error ? replaceError.message : "Failed to replace search match",
      );
    } finally {
      setReplaceOperation(null);
    }
  }, [debouncedQuery, refreshSearch, replaceOperation, replaceQuery, searchOptions, selectedMatch]);

  const replaceAll = useCallback(async () => {
    if (
      !debouncedQuery ||
      filePathsWithResults.length === 0 ||
      hasMoreResults ||
      replaceOperation
    ) {
      return;
    }

    setReplaceOperation("all");
    try {
      const count = await replaceAllInSources(
        filePathsWithResults,
        debouncedQuery,
        replaceQuery,
        searchOptions,
      );

      if (count > 0) {
        await refreshSearch();
        toast.success(`Replaced ${count} ${count === 1 ? "match" : "matches"}`);
      }
    } catch (replaceError) {
      toast.error(
        replaceError instanceof Error ? replaceError.message : "Failed to replace search matches",
      );
    } finally {
      setReplaceOperation(null);
    }
  }, [
    debouncedQuery,
    filePathsWithResults,
    hasMoreResults,
    refreshSearch,
    replaceOperation,
    replaceQuery,
    searchOptions,
  ]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setVisibleMatchLimit(CONTENT_SEARCH_INITIAL_RENDER_LIMIT);
    setPrioritizedFilePath(null);
    pendingFileNavigatorPathRef.current = null;
    setContextLinesByFile({});
    setSourceContentByPath({});
    sourceContentByPathRef.current = {};
  }, [searchKey]);

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

  const showInitialBusy = trimmedQuery.length > 0 && (isSearching || isSearchPending || isIndexing);
  const showBusy = showInitialBusy || isLoadingMore;
  const hasResults = results.length > 0;
  const totalMatches = useMemo(
    () => results.reduce((sum, result) => sum + result.total_matches, 0),
    [results],
  );
  const displayedCount = navigationItems.length;
  const hasMoreRenderedMatches = totalMatches > displayedCount;
  const hasMore = hasMoreRenderedMatches || hasMoreResults;
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
  const canReplace = Boolean(
    debouncedQuery && displayedCount > 0 && !searchWarning && !replaceOperation && !showInitialBusy,
  );
  const canReplaceAll = canReplace && !hasMoreResults;

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GlobalSearchToolbar
        inputRef={inputRef}
        replaceInputRef={replaceInputRef}
        query={query}
        onQueryChange={setQuery}
        onSearchKeyDown={handleKeyDown}
        detailsVisible={isReplaceVisible}
        onDetailsVisibleChange={setIsReplaceVisible}
        searchOptions={searchOptions}
        setSearchOption={setSearchOption}
        resultLabel={resultLabel}
        searchWarning={searchWarning}
        replaceQuery={replaceQuery}
        onReplaceQueryChange={setReplaceQuery}
        onReplace={replaceNext}
        onReplaceAll={replaceAll}
        canReplace={canReplace}
        canReplaceAll={canReplaceAll}
        replaceAllTooltip={
          hasMoreResults ? "Load all search results before replacing all" : undefined
        }
        includeQuery={includeQuery}
        onIncludeQueryChange={setIncludeQuery}
        excludeQuery={excludeQuery}
        onExcludeQueryChange={setExcludeQuery}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-primary-bg">
        {hasResults && !showInitialBusy ? (
          <GlobalSearchResults
            scrollContainerRef={scrollContainerRef}
            loadMoreRef={loadMoreRef}
            fileNavigatorItems={fileNavigatorItems}
            selectedFileNavigatorKey={selectedFileNavigatorKey}
            onFileNavigatorSelect={handleFileNavigatorSelect}
            fileNavigatorViewMode={fileNavigatorViewMode}
            onFileNavigatorViewModeChange={setFileNavigatorViewMode}
            navigatorSearchResetKey={searchKey}
            excerpts={excerpts}
            selectedItemKey={selectedItemKey}
            onOpen={handleFileClick}
            onExpandContext={handleExpandContext}
            onCollapseContext={handleCollapseContext}
            isContextExpanded={isContextExpanded}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            displayedCount={displayedCount}
            totalMatches={totalMatches}
            hasMoreResults={hasMoreResults}
          />
        ) : (
          <div
            ref={scrollContainerRef}
            className="custom-scrollbar-thin h-full overflow-y-auto bg-primary-bg"
          >
            <GlobalSearchState
              availability={availability}
              query={query}
              debouncedQuery={debouncedQuery}
              busyLabel={busyLabel}
              showBusy={showInitialBusy}
              error={error}
              hasFileFilters={Boolean(includeQuery || excludeQuery)}
              onRetry={() => void refreshSearch()}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default GlobalSearchBuffer;
