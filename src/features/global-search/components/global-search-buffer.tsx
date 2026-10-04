import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import type {
  FileNavigatorItem,
  FileNavigatorViewMode,
} from "@/features/file-explorer/components/file-navigator-sidebar";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { getBaseName, getRelativePath } from "@/utils/path-helpers";
import { ScrollArea } from "@/ui/scroll-area";
import {
  CONTENT_SEARCH_INITIAL_RENDER_LIMIT,
  CONTENT_SEARCH_RENDER_INCREMENT,
} from "../constants/limits";
import { useContentSearch } from "../hooks/use-content-search";
import { useKeyboardNavigation } from "../hooks/use-keyboard-navigation";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";
import { buildSearchExcerpts } from "../utils/search-excerpts";
import { useSearchContext } from "../hooks/use-search-context";
import { useSourceReplacement } from "../hooks/use-source-replacement";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { GlobalSearchResults } from "./global-search-results";
import type { MultibufferWorkspaceHandle } from "@/features/editor/components/multibuffer/multibuffer-workspace";
import { GlobalSearchState } from "./global-search-state";
import { GlobalSearchToolbar } from "./global-search-toolbar";

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
  expectedLine?: string;
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
  const activeWorkspaceId = useActiveWorkspaceId();
  const scopedWorkspaceId = useWorkspaceStoreScopeId();
  const workspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const shouldFocusOnMount = useRef(activeWorkspaceId === workspaceId);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const pendingFileNavigatorPathRef = useRef<string | null>(null);
  const workspaceRef = useRef<MultibufferWorkspaceHandle | null>(null);
  const [isReplaceVisible, setIsReplaceVisible] = useState(false);
  const { replaceQuery, setReplaceQuery } = useGlobalSearchSessionStore(
    useShallow((state) => ({
      replaceQuery: state.replaceQuery,
      setReplaceQuery: state.actions.setReplaceQuery,
    })),
  );
  const [visibleMatchLimit, setVisibleMatchLimit] = useState(CONTENT_SEARCH_INITIAL_RENDER_LIMIT);
  const [fileNavigatorViewMode, setFileNavigatorViewMode] = useState<FileNavigatorViewMode>("flat");
  const [isFileNavigatorVisible, setIsFileNavigatorVisible] = useState(true);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [prioritizedFilePath, setPrioritizedFilePath] = useState<string | null>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
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
    searchRevision,
    searchOptions,
    setSearchOption,
    includeQuery,
    setIncludeQuery,
    excludeQuery,
    setExcludeQuery,
    refreshSearch,
    loadMoreResults: loadMoreBackendResults,
  } = useContentSearch();
  const {
    replaceOperation,
    replaceNext: performReplaceNext,
    replaceAll: performReplaceAll,
  } = useSourceReplacement({
    workspaceId,
    searchKey,
    query: debouncedQuery,
    inputQuery: query,
    replacement: replaceQuery,
    options: searchOptions,
    results,
    refreshSearch,
  });
  const trimmedQuery = query.trim();
  const trimmedDebouncedQuery = debouncedQuery.trim();
  const isResultNavigationDisabled = isSearchPending || isSearching || isIndexing;
  const {
    contextLinesByFile,
    sourceContentByPath,
    expandContext: handleExpandContext,
    collapseContext: handleCollapseContext,
    isContextExpanded,
    isContextLoading,
  } = useSearchContext({
    workspaceId,
    searchKey,
    searchRevision,
    inputQuery: query,
    results,
    disabled: isResultNavigationDisabled,
  });

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
    const linesByPath = new Map(
      results.map((result) => [
        result.file_path,
        new Map(result.matches.map((line) => [line.line_number, line.line_content])),
      ]),
    );

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
            tone: "subtle",
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
          expectedLine: linesByPath.get(match.filePath)?.get(match.targetLine),
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
    isVisible: activeWorkspaceId === workspaceId,
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
      if (!match) return;
      workspaceRef.current?.scrollToSection(match.filePath, "nearest");
    },
    listenGlobally: false,
    resetKey: searchKey,
  });
  const setScrollContainer = useCallback<RefCallback<HTMLDivElement>>(
    (element) => {
      scrollContainerRef.current = element;
      setScrollElement((current) => (current === element ? current : element));
    },
    [scrollContainerRef],
  );

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

      workspaceRef.current?.scrollToSection(filePath, "start");
    },
    [excerptIndexByFilePath],
  );

  useEffect(() => {
    const filePath = pendingFileNavigatorPathRef.current;
    if (!filePath) return;

    const excerptIndex = excerptIndexByFilePath.get(filePath) ?? -1;
    if (excerptIndex < 0) return;

    pendingFileNavigatorPathRef.current = null;
    const frame = requestAnimationFrame(() => {
      workspaceRef.current?.scrollToSection(filePath, "start");
    });

    return () => cancelAnimationFrame(frame);
  }, [excerptIndexByFilePath]);

  const filePathsWithResults = useMemo(() => {
    const paths = new Set<string>();
    for (const result of results) {
      paths.add(result.file_path);
    }
    return Array.from(paths);
  }, [results]);
  const replaceNext = useCallback(async () => {
    if (
      !selectedMatch ||
      !debouncedQuery ||
      replaceOperation ||
      isResultNavigationDisabled ||
      searchWarning
    )
      return;
    await performReplaceNext({
      filePath: selectedMatch.filePath,
      line: selectedMatch.targetLine,
      column: selectedMatch.targetColumn,
      expectedLine: selectedMatch.expectedLine,
    });
  }, [
    debouncedQuery,
    isResultNavigationDisabled,
    performReplaceNext,
    replaceOperation,
    searchWarning,
    selectedMatch,
  ]);
  const replaceAll = useCallback(async () => {
    if (
      !debouncedQuery ||
      !filePathsWithResults.length ||
      hasMoreResults ||
      replaceOperation ||
      isResultNavigationDisabled ||
      searchWarning
    )
      return;
    await performReplaceAll(filePathsWithResults);
  }, [
    debouncedQuery,
    filePathsWithResults,
    hasMoreResults,
    isResultNavigationDisabled,
    performReplaceAll,
    replaceOperation,
    searchWarning,
  ]);

  useEffect(() => {
    if (!shouldFocusOnMount.current) return;
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
    scrollElement?.scrollTo({ top: 0, behavior: "auto" });
  }, [scrollElement, searchKey]);

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
      ? hasMore
        ? `${displayedCount} of ${hasMoreResults ? `${totalMatches}+` : totalMatches} results`
        : `${displayedCount} ${displayedCount === 1 ? "result" : "results"}`
      : null);
  const canReplace = Boolean(
    debouncedQuery && displayedCount > 0 && !searchWarning && !replaceOperation && !showInitialBusy,
  );
  const canReplaceAll = canReplace && !hasMoreResults;

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    const scrollContainer = scrollElement;
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
  }, [hasMore, loadMoreResults, scrollElement, showBusy]);

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
        fileNavigatorAvailable={fileNavigatorItems.length > 0}
        fileNavigatorVisible={isFileNavigatorVisible}
        onFileNavigatorVisibleChange={setIsFileNavigatorVisible}
      />

      <div className="relative min-h-0 flex-1 overflow-hidden bg-background">
        {hasResults && !showInitialBusy ? (
          <GlobalSearchResults
            workspaceRef={workspaceRef}
            scrollContainerRef={setScrollContainer}
            loadMoreRef={loadMoreRef}
            fileNavigatorItems={fileNavigatorItems}
            selectedFileNavigatorKey={selectedFileNavigatorKey}
            onFileNavigatorSelect={handleFileNavigatorSelect}
            fileNavigatorViewMode={fileNavigatorViewMode}
            onFileNavigatorViewModeChange={setFileNavigatorViewMode}
            navigatorSearchResetKey={searchKey}
            showFileNavigator={isFileNavigatorVisible}
            onShowFileNavigatorChange={setIsFileNavigatorVisible}
            excerpts={excerpts}
            selectedItemKey={selectedItemKey}
            onOpen={handleFileClick}
            onExpandContext={handleExpandContext}
            onCollapseContext={handleCollapseContext}
            isContextExpanded={isContextExpanded}
            isContextLoading={isContextLoading}
            hasMore={hasMore}
            isLoadingMore={isLoadingMore}
            displayedCount={displayedCount}
            totalMatches={totalMatches}
            hasMoreResults={hasMoreResults}
          />
        ) : (
          <ScrollArea
            fill="block"
            className="bg-background"
            viewportProps={{ ref: setScrollContainer }}
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
          </ScrollArea>
        )}
      </div>
    </div>
  );
};

export default GlobalSearchBuffer;
