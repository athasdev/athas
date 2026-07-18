import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import type { FileEntry } from "@/features/file-system/types/app.types";
import type {
  FileSearchResult,
  SearchFilesResponse,
} from "@/features/file-search/lib/file-search-api";
import { fffScanStatus, searchFilesContent } from "@/features/file-search/lib/file-search-api";
import { getNativeWorkspaceRootPaths } from "@/features/file-search/utils/file-search-paths";
import {
  loadProviderSearchFiles,
  searchProviderFilesContent,
} from "../services/provider-content-search";
import { CONTENT_SEARCH_PAGE_SIZE, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { mergeSearchResults } from "../utils/content-search-results";
import { createPathFilterPredicate } from "../utils/path-filters";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import type { ContentSearchOptions } from "../types/global-search.types";

export type { ContentSearchOptions } from "../types/global-search.types";

export type ContentSearchAvailability = "ready" | "no-workspace" | "unsupported";

const CONTEXT_LINES = 2;
const INDEX_STATUS_POLL_DELAY = 150;
const PROVIDER_FILE_CACHE_TTL = 2_000;

const canUseContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  Boolean(rootPath) &&
  !rootPath?.startsWith("remote://") &&
  !rootPath?.startsWith("wsl://") &&
  !rootPath?.startsWith("diff://");

const canUseProviderContentSearch = (rootPath: string | null | undefined): rootPath is string =>
  typeof rootPath === "string" && rootPath.startsWith("wsl://");

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

function hasPathFilters(includeQuery: string, excludeQuery: string): boolean {
  return Boolean(includeQuery.trim() || excludeQuery.trim());
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
  };
}

interface ProviderFileCache {
  rootPath: string;
  expiresAt: number;
  promise: Promise<FileEntry[]>;
}

interface ProviderSearchSession {
  searchKey: string;
  promise: Promise<FileEntry[]>;
}

export const useContentSearch = () => {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [rawResults, setRawResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchWarning, setSearchWarning] = useState<string | null>(null);
  const [nextFileOffset, setNextFileOffset] = useState(0);
  const [hasMoreResults, setHasMoreResults] = useState(false);
  const [searchedFiles, setSearchedFiles] = useState(0);
  const [searchableFiles, setSearchableFiles] = useState(0);
  const [isIndexing, setIsIndexing] = useState(false);
  const [indexedFiles, setIndexedFiles] = useState(0);
  const [scannedFiles, setScannedFiles] = useState(0);
  const [includeQuery, setIncludeQuery] = useState("");
  const [excludeQuery, setExcludeQuery] = useState("");
  const [debouncedIncludeQuery] = useDebounce(includeQuery, SEARCH_DEBOUNCE_DELAY);
  const [debouncedExcludeQuery] = useDebounce(excludeQuery, SEARCH_DEBOUNCE_DELAY);
  const [searchOptions, setSearchOptions] = useState<ContentSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
    useRegex: false,
  });
  const [resultsSearchKey, setResultsSearchKey] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const providerFileCacheRef = useRef<ProviderFileCache | null>(null);
  const providerSearchSessionRef = useRef<ProviderSearchSession | null>(null);
  const availability = getSearchAvailability(rootFolderPath);
  const searchKey = useMemo(
    () =>
      [
        nativeRootPaths.join("\n") || rootFolderPath || "",
        debouncedQuery,
        debouncedIncludeQuery,
        debouncedExcludeQuery,
        Number(searchOptions.caseSensitive),
        Number(searchOptions.wholeWord),
        Number(searchOptions.useRegex),
      ].join("\0"),
    [
      debouncedExcludeQuery,
      debouncedIncludeQuery,
      debouncedQuery,
      nativeRootPaths,
      rootFolderPath,
      searchOptions.caseSensitive,
      searchOptions.useRegex,
      searchOptions.wholeWord,
    ],
  );
  const isSearchPending =
    query !== debouncedQuery ||
    includeQuery !== debouncedIncludeQuery ||
    excludeQuery !== debouncedExcludeQuery ||
    (Boolean(debouncedQuery.trim()) && availability === "ready" && resultsSearchKey !== searchKey);

  const setSearchOption = useCallback(
    <K extends keyof ContentSearchOptions>(key: K, value: ContentSearchOptions[K]) => {
      setSearchOptions((previous) => ({ ...previous, [key]: value }));
    },
    [],
  );

  const getProviderFiles = useCallback(
    (rootPath: string, currentSearchKey: string, fileOffset: number) => {
      const currentSession = providerSearchSessionRef.current;
      if (fileOffset > 0 && currentSession?.searchKey === currentSearchKey) {
        return currentSession.promise;
      }

      const now = Date.now();
      const cached = providerFileCacheRef.current;
      const promise =
        cached && cached.rootPath === rootPath && cached.expiresAt > now
          ? cached.promise
          : loadProviderSearchFiles();

      if (promise !== cached?.promise) {
        providerFileCacheRef.current = {
          rootPath,
          expiresAt: now + PROVIDER_FILE_CACHE_TTL,
          promise,
        };
      }

      providerSearchSessionRef.current = { searchKey: currentSearchKey, promise };
      return promise;
    },
    [],
  );

  const requestSearchPage = useCallback(
    async (fileOffset: number, currentRequestId: number): Promise<SearchFilesResponse | null> => {
      const searchRootPath = rootFolderPath;
      if (!searchRootPath || availability !== "ready") return null;

      if (canUseProviderContentSearch(searchRootPath)) {
        const files = await getProviderFiles(searchRootPath, searchKey, fileOffset);
        if (currentRequestId !== requestIdRef.current) return null;

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
          isCancelled: () => currentRequestId !== requestIdRef.current,
        });
      }

      return searchFilesContent({
        root_paths: nativeRootPaths,
        query: debouncedQuery,
        case_sensitive: searchOptions.caseSensitive,
        whole_word: searchOptions.wholeWord,
        use_regex: searchOptions.useRegex,
        max_results: CONTENT_SEARCH_PAGE_SIZE,
        file_offset: fileOffset,
        context_lines: CONTEXT_LINES,
      });
    },
    [
      availability,
      debouncedExcludeQuery,
      debouncedIncludeQuery,
      debouncedQuery,
      getProviderFiles,
      nativeRootPaths,
      rootFolderPath,
      searchKey,
      searchOptions,
    ],
  );

  const requestVisibleSearchPage = useCallback(
    async (fileOffset: number, currentRequestId: number): Promise<SearchFilesResponse | null> => {
      const matchesPathFilters = createPathFilterPredicate(
        rootFolderPath,
        debouncedIncludeQuery,
        debouncedExcludeQuery,
      );
      const shouldSkipEmptyPages = hasPathFilters(debouncedIncludeQuery, debouncedExcludeQuery);
      let response: SearchFilesResponse | null = null;
      let nextOffset = fileOffset;

      while (currentRequestId === requestIdRef.current) {
        const page = await requestSearchPage(nextOffset, currentRequestId);
        if (!page || currentRequestId !== requestIdRef.current) return null;
        if (page.is_indexing) return page;

        const visibleResults = page.results.filter((result) =>
          matchesPathFilters(result.file_path),
        );
        response = mergeSearchResponses(response, page, visibleResults);

        if (!shouldSkipEmptyPages || visibleResults.length > 0 || !page.has_more) {
          return response;
        }

        if (page.next_file_offset <= nextOffset) {
          return {
            ...response,
            has_more: false,
            next_file_offset: 0,
          };
        }

        nextOffset = page.next_file_offset;
      }

      return null;
    },
    [debouncedExcludeQuery, debouncedIncludeQuery, requestSearchPage, rootFolderPath],
  );

  const performSearch = useCallback(async () => {
    const currentRequestId = ++requestIdRef.current;
    const hasQuery = Boolean(debouncedQuery.trim());

    if (!hasQuery || availability !== "ready") {
      setRawResults([]);
      setIsSearching(false);
      setIsLoadingMore(false);
      setError(null);
      setSearchWarning(null);
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
    setSearchWarning(null);
    setRawResults([]);
    setNextFileOffset(0);
    setHasMoreResults(false);
    setSearchedFiles(0);
    setSearchableFiles(0);
    setIsIndexing(false);

    try {
      const response = await requestVisibleSearchPage(0, currentRequestId);
      if (!response || currentRequestId !== requestIdRef.current) return;

      if (response.is_indexing) {
        setIsIndexing(true);
        setIndexedFiles(response.indexed_files);
        setScannedFiles(response.indexed_files);
        return;
      }

      setIndexedFiles(response.indexed_files);
      setScannedFiles(response.indexed_files);
      setRawResults(response.results);
      setNextFileOffset(response.next_file_offset);
      setHasMoreResults(response.has_more);
      setSearchedFiles(response.searched_files);
      setSearchableFiles(response.searchable_files);
      setSearchWarning(
        response.regex_fallback_error
          ? "Invalid regular expression; showing literal matches"
          : null,
      );
      setResultsSearchKey(searchKey);
    } catch (searchError) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error("Search error:", searchError);
      setError(`Search failed: ${getErrorMessage(searchError)}`);
      setRawResults([]);
      setNextFileOffset(0);
      setHasMoreResults(false);
      setIsIndexing(false);
      setResultsSearchKey(searchKey);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsSearching(false);
      }
    }
  }, [availability, debouncedQuery, requestVisibleSearchPage, searchKey]);

  const loadMoreResults = useCallback(async () => {
    if (
      !debouncedQuery.trim() ||
      availability !== "ready" ||
      !hasMoreResults ||
      nextFileOffset <= 0 ||
      isSearching ||
      isLoadingMore
    ) {
      return;
    }

    const currentRequestId = requestIdRef.current;
    setIsLoadingMore(true);
    setError(null);

    try {
      const response = await requestVisibleSearchPage(nextFileOffset, currentRequestId);
      if (!response || currentRequestId !== requestIdRef.current) return;

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
      setSearchWarning(
        response.regex_fallback_error
          ? "Invalid regular expression; showing literal matches"
          : null,
      );
    } catch (searchError) {
      if (currentRequestId !== requestIdRef.current) return;
      console.error("Search error:", searchError);
      setError(`Search failed: ${getErrorMessage(searchError)}`);
    } finally {
      if (currentRequestId === requestIdRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [
    availability,
    debouncedQuery,
    hasMoreResults,
    isLoadingMore,
    isSearching,
    nextFileOffset,
    requestVisibleSearchPage,
  ]);

  useEffect(() => {
    if (!isIndexing || !debouncedQuery.trim() || !canUseContentSearch(rootFolderPath)) return;

    const pollingRequestId = requestIdRef.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const pollScanStatus = async () => {
      try {
        const status = await fffScanStatus(nativeRootPaths);
        if (disposed || pollingRequestId !== requestIdRef.current) return;

        setIsIndexing(status.is_scanning);
        setScannedFiles(status.scanned_files_count);
        setIndexedFiles(status.indexed_files);
        failureCount = 0;

        if (status.is_scanning) {
          timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);
          return;
        }

        void performSearch();
      } catch (statusError) {
        if (disposed || pollingRequestId !== requestIdRef.current) return;
        console.error("Search index status error:", statusError);
        failureCount++;
        if (failureCount >= 3) {
          setIsIndexing(false);
          setError(`Search indexing failed: ${getErrorMessage(statusError)}`);
          setResultsSearchKey(searchKey);
          return;
        }
        timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);
      }
    };

    timer = setTimeout(pollScanStatus, INDEX_STATUS_POLL_DELAY);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [debouncedQuery, isIndexing, nativeRootPaths, performSearch, rootFolderPath, searchKey]);

  useEffect(() => {
    void performSearch();
  }, [performSearch]);

  useEffect(() => {
    if (providerFileCacheRef.current?.rootPath !== rootFolderPath) {
      providerFileCacheRef.current = null;
      providerSearchSessionRef.current = null;
    }
  }, [rootFolderPath]);

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
    refreshSearch: performSearch,
    loadMoreResults,
  };
};
