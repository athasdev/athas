import { useEffect, useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import {
  type FileSearchResult,
  searchFilesContent,
} from "@/features/file-search/api/file-search-api";
import {
  canUseNativeFileSearch,
  getNativeWorkspaceRootPaths,
} from "@/features/file-search/services/file-search-paths";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { Spinner } from "@/ui/spinner";
import { getBaseName, getDirectoryPath } from "@/utils/path-helpers";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const TEXT_SEARCH_DEBOUNCE_DELAY = 200;
const TEXT_SEARCH_MIN_LENGTH = 2;
const TEXT_SEARCH_MAX_MATCHES = 200;
/** Lines are cut to start this many characters before the match, so it stays in view. */
const EXCERPT_LEAD = 24;

interface TextMatch {
  key: string;
  filePath: string;
  line: number;
  column: number;
  excerpt: string;
}

export function toTextMatches(results: readonly FileSearchResult[], limit: number): TextMatch[] {
  const matches: TextMatch[] = [];
  for (const result of results) {
    for (const match of result.matches) {
      if (matches.length >= limit) return matches;
      const indent = match.line_content.length - match.line_content.trimStart().length;
      const start = Math.max(indent, match.column_start - EXCERPT_LEAD);
      const excerpt = match.line_content.slice(start).trimEnd();
      matches.push({
        key: `${result.file_path}:${match.line_number}:${match.column_start}`,
        filePath: result.file_path,
        line: match.line_number,
        column: match.column_start + 1,
        excerpt: start > indent ? `…${excerpt}` : excerpt,
      });
    }
  }
  return matches;
}

/** Text across the project's files, from the same index as project search. */
export function useTextSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const workspaceFolders = useProjectStore((state) => state.workspaceFolders);
  const rootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const canSearch = canUseNativeFileSearch(rootFolderPath) && rootPaths.length > 0;
  const [debouncedQuery] = useDebounce(query.trim(), TEXT_SEARCH_DEBOUNCE_DELAY);
  const searchKey =
    isActive && canSearch && debouncedQuery.length >= TEXT_SEARCH_MIN_LENGTH
      ? JSON.stringify([debouncedQuery, rootPaths])
      : null;
  const [state, setState] = useState<{
    key: string | null;
    matches: TextMatch[];
    isDone: boolean;
  }>({ key: null, matches: [], isDone: true });

  useEffect(() => {
    if (!searchKey) return;
    let cancelled = false;
    const found: FileSearchResult[] = [];
    setState({ key: searchKey, matches: [], isDone: false });
    searchFilesContent(
      { root_paths: rootPaths, query: debouncedQuery, max_results: TEXT_SEARCH_MAX_MATCHES },
      {
        isCancelled: () => cancelled,
        onResults: (results) => {
          if (cancelled) return;
          found.push(...results);
          setState({
            key: searchKey,
            matches: toTextMatches(found, TEXT_SEARCH_MAX_MATCHES),
            isDone: false,
          });
        },
      },
    )
      .then((response) => {
        if (cancelled) return;
        setState({
          key: searchKey,
          matches: toTextMatches(response.results, TEXT_SEARCH_MAX_MATCHES),
          isDone: true,
        });
      })
      .catch(() => {
        if (!cancelled) setState({ key: searchKey, matches: [], isDone: true });
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, rootPaths, searchKey]);

  const isCurrent = searchKey !== null && state.key === searchKey;
  const matches = isCurrent ? state.matches : [];
  const isLoading =
    searchKey !== null ? !isCurrent || !state.isDone : query.trim() !== debouncedQuery;

  const items = useMemo(
    () =>
      matches.map((match): QuickOpenItem => ({
        key: match.key,
        icon: <ThemedFileIcon fileName={getBaseName(match.filePath)} isDir={false} />,
        title: (
          <span className="font-mono">
            <SearchMatchHighlight text={match.excerpt} query={debouncedQuery} />
          </span>
        ),
        description: `${getBaseName(match.filePath)} · ${getDirectoryPath(match.filePath, rootFolderPath)}`,
        accessory: <CommandItemBadge>:{match.line}</CommandItemBadge>,
        select: () => {
          close();
          void handleFileSelect(match.filePath, false, match.line, match.column, undefined, false);
        },
      })),
    [close, debouncedQuery, handleFileSelect, matches, rootFolderPath],
  );

  const fileCount = new Set(matches.map((match) => match.filePath)).size;

  return {
    items,
    isLoading,
    summary:
      isCurrent && items.length > 0
        ? `${items.length}${items.length >= TEXT_SEARCH_MAX_MATCHES ? "+" : ""} in ${fileCount} ${fileCount === 1 ? "file" : "files"}`
        : undefined,
    empty: (
      <CommandEmpty>
        {!canSearch ? (
          "Open a folder to search text in its files"
        ) : query.trim().length < TEXT_SEARCH_MIN_LENGTH ? (
          "Type at least two characters to search file contents"
        ) : isLoading ? (
          <Spinner label="Searching files" showLabel compact />
        ) : (
          "No matches in the project"
        )}
      </CommandEmpty>
    ),
  };
}
