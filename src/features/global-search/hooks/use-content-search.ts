import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useShallow } from "zustand/react/shallow";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type {
  FileSearchResult,
  SearchFilesResponse,
} from "@/features/file-search/api/file-search-api";
import { searchFilesContent } from "@/features/file-search/api/file-search-api";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/services/file-search-paths";
import {
  loadProviderSearchFiles,
  searchProviderFilesContent,
} from "../services/provider-content-search";
import { CONTENT_SEARCH_PAGE_SIZE, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { mergeSearchResults } from "../utils/content-search-results";
import { createPathFilterPredicate } from "../utils/path-filters";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import {
  useActiveWorkspaceId,
  useWorkspaceStoreScopeId,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { useGlobalSearchSessionStore } from "../stores/global-search-session.store";
import { useProjectStore } from "@/features/workspace/stores/project.store";

export type ContentSearchAvailability = "ready" | "no-workspace" | "unsupported";

const CONTEXT_LINES = 2;

const canUseContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) &&
  !rootPath?.startsWith("remote://") &&
  !rootPath?.startsWith("wsl://") &&
  !rootPath?.startsWith("diff://");

const canUseProviderContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  typeof rootPath === "string" &&
  (rootPath.startsWith("wsl://") || rootPath.startsWith("remote://"));

function getSearchAvailability(rootPath: string | null | undefined): ContentSearchAvailability {
  if (!rootPath) return "no-workspace";
  if (canUseContentSearch(rootPath) || canUseProviderContentSearch(rootPath)) return "ready";
  return "unsupported";
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unknown search error";
}

function mergeSearchResponses(
  previous: SearchFilesResponse | null,
  next: SearchFilesResponse,
  results: FileSearchResult[],
): SearchFilesResponse {
  if (!previous) {
    return {
      ...next,
      results,
      files_with_matches: results.length,
    };
  }

  const mergedResults = mergeSearchResults(previous.results, results);
  return {
    ...next,
    results: mergedResults,
    searched_files: previous.searched_files + next.searched_files,
    files_with_matches: mergedResults.length,
    regex_fallback_error: previous.regex_fallback_error ?? next.regex_fallback_error,
    unreadable_files: (previous.unreadable_files ?? 0) + (next.unreadable_files ?? 0),
    first_read_error: previous.first_read_error ?? next.first_read_error,
  };
}

interface ProviderSearchSession {
  requestId: number;
  promise: Promise<FileEntry[] | null>;
}

export const useContentSearch = () => {
  const scopedWorkspaceId = useWorkspaceStoreScopeId();
  const activeWorkspaceId = useActiveWorkspaceId();
  const workspaceId = scopedWorkspaceId ?? activeWorkspaceId;
  const fileSystemStore = useFileSystemStore.getStore(workspaceId);
  const projectStore = useProjectStore.getStore(workspaceId);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const workspaceFolders = useProjectStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const searchRootPaths = useMemo(
    () =>
      Array.from(
        new Set(
          [rootFolderPath, ...workspaceFolders.map((folder) => folder.path)].filter(
            (path): path is string =>
              canUseContentSearch(path) || canUseProviderContentSearch(path),
          ),
        ),
      ),
    [rootFolderPath, workspaceFolders],
  );
  const useProviderSearch = searchRootPaths.some(canUseProviderContentSearch);
  const {
    query,
    includeQuery,
    excludeQuery,
    searchOptions,
    setQuery,
    setIncludeQuery,
    setExcludeQuery,
    setSearchOption,
  } = useGlobalSearchSessionStore(
    useShallow((state) => ({
      query: state.query,
      includeQuery: state.includeQuery,
      excludeQuery: state.excludeQuery,
      searchOptions: state.searchOptions,
      setQuery: state.actions.setQuery,
      setIncludeQuery: state.actions.setIncludeQuery,
      setExcludeQuery: state.actions.setExcludeQuery,
      setSearchOption: state.actions.setSearchOption,
    })),
  );
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [searchRevision, setSearchRevision] = useState(0);
  const [rawResults, setRawResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regexWarning, setRegexWarning] = useState<string | null>(null);
  const [readFailures, setReadFailures] = useState({ count: 0, first: null as string | null });
  const searchWarning =
    [
      regexWarning,
      readFailures.count
        ? `Search incomplete: ${readFailures.count} ${readFailures.count === 1 ? "file" : "files"} could not be read. ${readFailures.first ?? ""}`
        : null,
    ]
      .filter(Boolean)
      .join("; ") || null;
  const [nextFileOffset, setNextFileOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [searchedFiles, setSearchedFiles] = useState(0);
  const [searchableFiles, setSearchableFiles] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState(0);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [debouncedIncludeQuery] = useDebounce(includeQuery, SEARCH_DEBOUNCE_DELAY);
  const [debouncedExcludeQuery] = useDebounce(excludeQuery, SEARCH_DEBOUNCE_DELAY);
  const [resultsSearchKey, setResultsSearchKey] = useState<string | null>(null);
  const [resultsOwner, setResultsOwner] = useState<typeof fileSystemStore | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const loadingMoreRequestRef = useRef<number | null>(null);
  const providerSearchSessionRef = useRef<ProviderSearchSession | null>(null);
  const availability = getSearchAvailability(rootFolderPath);
  const searchKey = useMemo(
    () =>
      [
        workspaceId,
        JSON.stringify(searchRootPaths),
        debouncedQuery,
        debouncedIncludeQuery,
        debouncedExcludeQuery,
        Number(searchOptions.caseSensitive),
        Number(searchOptions.wholeWord),
        Number(searchOptions.useRegex),
      ].join("\0"),
    [
      workspaceId,
      debouncedExcludeQuery,
      debouncedIncludeQuery,
      debouncedQuery,
      searchRootPaths,
      searchOptions.caseSensitive,
      searchOptions.useRegex,
      searchOptions.wholeWord,
    ],
  );
  const lifetime = useMemo(
    () => ({ fileSystemStore, workspaceId, searchKey, query, includeQuery, excludeQuery }),
    [fileSystemStore, workspaceId, searchKey, query, includeQuery, excludeQuery],
  );
  const lifetimeRef = useRef(lifetime);
  lifetimeRef.current = lifetime;
  const isViewCurrent = useCallback(
    () =>
      mountedRef.current &&
      lifetimeRef.current === lifetime &&
      workspaceRuntimeRegistry.getWorkspace(workspaceId)?.stores.get("file-system") ===
        fileSystemStore &&
      projectStore.getState().rootFolderPath === rootFolderPath &&
      projectStore.getState().workspaceFolders === workspaceFolders,
    [lifetime, workspaceId, fileSystemStore, projectStore, rootFolderPath, workspaceFolders],
  );
  const isRequestCurrent = useCallback(
    (requestId: number) => isViewCurrent() && requestId === requestIdRef.current,
    [isViewCurrent],
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current++;
      loadingMoreRequestRef.current = null;
    };
  }, []);
  const isSearchPending =
    query !== debouncedQuery ||
    includeQuery !== debouncedIncludeQuery ||
    excludeQuery !== debouncedExcludeQuery ||
    (Boolean(debouncedQuery.trim()) &&
      availability === "ready" &&
      (resultsSearchKey !== searchKey || resultsOwner !== fileSystemStore));

  const getProviderFiles = useCallback(
    (currentRequestId: number, fileOffset: number) => {
      const currentSession = providerSearchSessionRef.current;
      if (fileOffset > 0 && currentSession?.requestId === currentRequestId)
        return currentSession.promise;
      const promise = loadProviderSearchFiles(projectStore, {
        isCancelled: () => !isRequestCurrent(currentRequestId),
      });
      providerSearchSessionRef.current = { requestId: currentRequestId, promise };
      void promise.catch(() => {
        if (providerSearchSessionRef.current?.promise === promise)
          providerSearchSessionRef.current = null;
      });
      return promise;
    },
    [projectStore, isRequestCurrent],
  );

  const requestSearchPage = useCallback(
    async (
      fileOffset: number,
      currentRequestId: number,
      onResults?: (results: FileSearchResult[]) => void,
    ): Promise<SearchFilesResponse | null> => {
      const searchRootPath = rootFolderPath;
      if (!searchRootPath || availability !== "ready") return null;

      if (useProviderSearch) {
        const files = await getProviderFiles(currentRequestId, fileOffset);
        if (!files || !isRequestCurrent(currentRequestId)) return null;

        return searchProviderFilesContent({
          files,
          query: debouncedQuery,
          rootFolderPath: searchRootPath,
          options: searchOptions,
          maxResults: CONTENT_SEARCH_PAGE_SIZE,
          fileOffset,
          contextLines: CONTEXT_LINES,
          includeQuery: debouncedIncludeQuery,
          excludeQuery: debouncedExcludeQuery,
          isCancelled: () => !isRequestCurrent(currentRequestId),
        });
      }

      return searchFilesContent(
        {
          root_paths: nativeRootPaths,
          query: debouncedQuery,
          case_sensitive: searchOptions.caseSensitive,
          whole_word: searchOptions.wholeWord,
          use_regex: searchOptions.useRegex,
          max_results: CONTENT_SEARCH_PAGE_SIZE,
          file_offset: fileOffset,
          context_lines: CONTEXT_LINES,
        },
        {
          isCancelled: () => !isRequestCurrent(currentRequestId),
          onIndexing: (indexed) => {
            if (!isRequestCurrent(currentRequestId)) return;
            setIsIndexing(true);
            setIndexedFiles(indexed);
            setScannedFiles(indexed);
          },
          onResults: (results) => {
            if (!isRequestCurrent(currentRequestId)) return;
            setIsIndexing(false);
            onResults?.(results);
          },
        },
      );
    },
    [
      availability,
      debouncedExcludeQuery,
      debouncedIncludeQuery,
      debouncedQuery,
      getProviderFiles,
      isRequestCurrent,
      nativeRootPaths,
      rootFolderPath,
      useProviderSearch,
      searchOptions,
    ],
  );

  const requestVisibleSearchPage = useCallback(
    async (
      fileOffset: number,
      currentRequestId: number,
      onVisibleResults?: (results: FileSearchResult[]) => void,
    ): Promise<SearchFilesResponse | null> => {
      const matchesPathFilters = createPathFilterPredicate(
        rootFolderPath,
        debouncedIncludeQuery,
        debouncedExcludeQuery,
      );
      const showStreamedResults = onVisibleResults
        ? (results: FileSearchResult[]) => {
            const visible = results.filter((result) => matchesPathFilters(result.file_path));
            if (visible.length > 0) onVisibleResults(visible);
          }
        : undefined;
      let response: SearchFilesResponse | null = null;
      let nextOffset = fileOffset;

      while (isRequestCurrent(currentRequestId)) {
        const page = await requestSearchPage(nextOffset, currentRequestId, showStreamedResults);
        if (!page || !isRequestCurrent(currentRequestId)) return null;
        if (page.is_indexing) return page;

        const visibleResults = page.results.filter((result) =>
          matchesPathFilters(result.file_path),
        );
        response = mergeSearchResponses(response, page, visibleResults);

        if (visibleResults.length > 0 || !page.has_more) {
          return response;
        }

        if (page.next_file_offset <= nextOffset)
          throw new Error("Search pagination did not advance. Refresh the search to try again.");

        nextOffset = page.next_file_offset;
      }

      return null;
    },
    [
      debouncedExcludeQuery,
      debouncedIncludeQuery,
      requestSearchPage,
      rootFolderPath,
      isRequestCurrent,
    ],
  );

  const performSearch = useCallback(async () => {
    if (!isViewCurrent()) return;
    const currentRequestId = ++requestIdRef.current;
    setSearchRevision(currentRequestId);
    loadingMoreRequestRef.current = null;
    providerSearchSessionRef.current = null;
    const hasQuery = Boolean(debouncedQuery.trim());

    if (
      !hasQuery ||
      availability !== "ready" ||
      query !== debouncedQuery ||
      includeQuery !== debouncedIncludeQuery ||
      excludeQuery !== debouncedExcludeQuery
    ) {
      setRawResults([]);
      setIsSearching(false);
      setIsLoadingMore(false);
      setError(null);
      setRegexWarning(null);
      setReadFailures({ count: 0, first: null });
      setNextFileOffset(0);
      setHasMoreResults(false);
      setSearchedFiles(0);
      setSearchableFiles(0);
      setIsIndexing(false);
      setIndexedFiles(0);
      setScannedFiles(0);
      setResultsSearchKey(null);
      return;
    }

    setIsSearching(true);
    setIsLoadingMore(false);
    setError(null);
    setRegexWarning(null);
    setReadFailures({ count: 0, first: null });
    setRawResults([]);
    setNextFileOffset(0);
    setHasMoreResults(false);
    setSearchedFiles(0);
    setSearchableFiles(0);
    setIsIndexing(false);

    try {
      // Matches stream in while the page is read; the finished page replaces them below.
      const response = await requestVisibleSearchPage(0, currentRequestId, (results) =>
        setRawResults((previous) => mergeSearchResults(previous, results)),
      );
      if (!response || !isRequestCurrent(currentRequestId)) return;

      if (response.is_indexing) {
        setIsIndexing(true);
        setIndexedFiles(response.indexed_files);
        setScannedFiles(response.indexed_files);
        return;
      }

      setIsIndexing(false);
      setIndexedFiles(response.indexed_files);
      setScannedFiles(response.indexed_files);
      setRawResults(response.results);
      setNextFileOffset(response.next_file_offset);
      setHasMoreResults(response.has_more);
      setSearchedFiles(response.searched_files);
      setSearchableFiles(response.searchable_files);
      setRegexWarning(
        response.regex_fallback_error
          ? "Invalid regular expression; showing literal matches"
          : null,
      );
      setReadFailures({
        count: response.unreadable_files ?? 0,
        first: response.first_read_error ?? null,
      });
      setResultsSearchKey(searchKey);
      setResultsOwner(fileSystemStore);
    } catch (searchError) {
      if (!isRequestCurrent(currentRequestId)) return;
      console.error("Search error:", searchError);
      setError(`Search failed: ${getErrorMessage(searchError)}`);
      setRawResults([]);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setIsIndexing(false);
      setResultsSearchKey(searchKey);
      setResultsOwner(fileSystemStore);
    } finally {
      if (isRequestCurrent(currentRequestId)) {
        setIsSearching(false);
      }
    }
  }, [
    availability,
    debouncedQuery,
    requestVisibleSearchPage,
    searchKey,
    isViewCurrent,
    isRequestCurrent,
    fileSystemStore,
    query,
    includeQuery,
    excludeQuery,
    debouncedIncludeQuery,
    debouncedExcludeQuery,
  ]);

  const loadMoreResults = useCallback(async () => {
    if (
      !debouncedQuery.trim() ||
      availability !== "ready" ||
      !hasMoreResults ||
      nextFileOffset <= 0 ||
      isSearching ||
      isLoadingMore ||
      loadingMoreRequestRef.current !== null ||
      !isViewCurrent() ||
      isSearchPending
    ) {
      return;
    }

    const currentRequestId = requestIdRef.current;
    loadingMoreRequestRef.current = currentRequestId;
    setIsLoadingMore(true);
    setError(null);

    try {
      const response = await requestVisibleSearchPage(nextFileOffset, currentRequestId);
      if (!response || !isRequestCurrent(currentRequestId)) return;

      if (response.is_indexing) {
        setIsIndexing(true);
        setIndexedFiles(response.indexed_files);
        setScannedFiles(response.indexed_files);
        return;
      }

      setIndexedFiles(response.indexed_files);
      setScannedFiles(response.indexed_files);
      setRawResults((previousResults) => mergeSearchResults(previousResults, response.results));
      setNextFileOffset(response.next_file_offset);
      setHasMoreResults(response.has_more);
      setSearchedFiles((previous) =>
        response.searchable_files > 0
          ? Math.min(previous + response.searched_files, response.searchable_files)
          : previous + response.searched_files,
      );
      setSearchableFiles(response.searchable_files);
      setRegexWarning(
        (previous) =>
          previous ??
          (response.regex_fallback_error
            ? "Invalid regular expression; showing literal matches"
            : null),
      );
      setReadFailures((previous) => ({
        count: previous.count + (response.unreadable_files ?? 0),
        first: previous.first ?? response.first_read_error ?? null,
      }));
    } catch (searchError) {
      if (!isRequestCurrent(currentRequestId)) return;
      console.error("Search error:", searchError);
      setError(`Search failed: ${getErrorMessage(searchError)}`);
    } finally {
      if (isRequestCurrent(currentRequestId)) {
        loadingMoreRequestRef.current = null;
        setIsLoadingMore(false);
      }
    }
  }, [
    availability,
    debouncedQuery,
    hasMoreResults,
    isLoadingMore,
    isSearching,
    isViewCurrent,
    isRequestCurrent,
    isSearchPending,
    nextFileOffset,
    requestVisibleSearchPage,
  ]);

  useEffect(() => {
    void performSearch();
  }, [performSearch]);

  return {
    query,
    setQuery,
    debouncedQuery,
    results: rawResults,
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
    searchRevision,
    refreshSearch: performSearch,
    loadMoreResults,
  };
};
