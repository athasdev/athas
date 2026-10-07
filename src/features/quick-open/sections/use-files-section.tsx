import { useCallback, useMemo } from "react";
import { useDebounce } from "use-debounce";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { useFffSearch } from "@/features/file-search/hooks/use-fff-search";
import {
  canUseNativeFileSearch,
  getNativeWorkspaceRootPaths,
} from "@/features/file-search/utils/file-search-paths";
import type { FileCategory, FileItem } from "@/features/file-search/types/file-search.types";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import { CommandItemBadge } from "@/ui/command";
import { ClockIcon } from "@/ui/icons";
import { getBaseName, getDirectoryPath } from "@/utils/path-helpers";
import { EmptyState } from "../components/empty-state";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "../hooks/use-file-loader";
import { useFileSearch } from "../hooks/use-file-search";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

export function useFilesSection({
  query,
  isActive,
  isVisible,
  close,
}: QuickOpenSectionInput & { isVisible: boolean }): QuickOpenSectionResult {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.actions.addOrUpdateRecentFile);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const searchQuery = isActive ? debouncedQuery : "";

  // The file list loads as soon as quick open shows, so switching back to Files is instant.
  const {
    files,
    hasLoadedFiles,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isVisible);
  const { hits, isSearching } = useFffSearch(searchQuery, isActive, nativeRootPaths);
  const { openBufferFiles, recentFilesInResults, otherFiles } = useFileSearch(
    files,
    searchQuery,
    isActive ? hits : null,
    {
      hasLoadedFiles,
      rootFolderPath,
      useBackendResults: canUseNativeFileSearch(rootFolderPath) && searchQuery.trim().length > 0,
    },
  );
  const displayRoot = rootFolderPath || loaderRootFolder;

  const openFile = useCallback(
    (path: string) => {
      addOrUpdateRecentFile(path, getBaseName(path, path), {
        workspacePath: rootFolderPath ?? null,
        external: false,
      });
      void handleFileSelect(path, false);
      close();
    },
    [addOrUpdateRecentFile, close, handleFileSelect, rootFolderPath],
  );

  const items = useMemo(() => {
    const toItem = (file: FileItem, category: FileCategory): QuickOpenItem => ({
      key: file.path,
      icon: <ThemedFileIcon fileName={file.name} isDir={false} />,
      title: <SearchMatchHighlight text={file.name} query={searchQuery} />,
      description: (
        <SearchMatchHighlight text={getDirectoryPath(file.path, displayRoot)} query={searchQuery} />
      ),
      accessory:
        category === "open" ? (
          <CommandItemBadge>Open</CommandItemBadge>
        ) : category === "recent" ? (
          <CommandItemBadge>
            <ClockIcon />
          </CommandItemBadge>
        ) : undefined,
      select: () => openFile(file.path),
    });
    return [
      ...openBufferFiles.map((file) => toItem(file, "open")),
      ...recentFilesInResults.map((file) => toItem(file, "recent")),
      ...otherFiles.map((file) => toItem(file, "other")),
    ];
  }, [displayRoot, openBufferFiles, openFile, otherFiles, recentFilesInResults, searchQuery]);

  const isLoading = isLoadingFiles || isSearching;
  const summary =
    isLoading || files.length === 0
      ? undefined
      : searchQuery
        ? `${items.length} / ${files.length}`
        : `${files.length} ${files.length === 1 ? "file" : "files"}`;

  return {
    items,
    isLoading,
    summary,
    empty: (
      <EmptyState
        isLoadingFiles={isLoading}
        isIndexing={isIndexing || isSearching}
        debouncedQuery={searchQuery}
        query={query}
        filesLength={files.length}
        hasRootFolder={!!displayRoot}
      />
    ),
  };
}
