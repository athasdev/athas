import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getOpenBufferSearchSnapshot } from "@/features/editor/utils/open-buffer-search-snapshot";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import {
  MAX_FILE_SEARCH_RESULTS as MAX_RESULTS,
  MAX_OPEN_BUFFERS_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
} from "@/features/file-search/constants/file-search-limits";
import type { FffSearchHit } from "@/features/file-search/lib/file-search-api";
import type { CategorizedFiles, FileItem } from "@/features/file-search/types/file-search.types";
import {
  categorizeFileSearchHits,
  categorizeFuzzyFileSearch,
  indexRecentSearchFiles,
} from "@/features/file-search/utils/categorize-file-search-results";
import { insertSortedLimited } from "@/features/file-search/utils/sorted-search-results";
import { filterQuickOpenRecentFiles } from "../utils/file-filtering";
import { fuzzyScore } from "../utils/fuzzy-search";

interface FileSearchOptions {
  hasLoadedFiles?: boolean;
  rootFolderPath?: string | null;
  useBackendResults?: boolean;
}

function recentFileToItem(file: RecentFile): FileItem {
  return {
    name: file.name,
    path: file.path,
    isDir: false,
  };
}

export const useFileSearch = (
  files: FileItem[],
  debouncedQuery: string,
  fffHits: FffSearchHit[] | null = null,
  options: FileSearchOptions = {},
) => {
  const bufferSearchSnapshot = useBufferStore((state) =>
    getOpenBufferSearchSnapshot(state.buffers, state.activeBufferId),
  );
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.actions.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    const { activeBufferPath, openBufferPaths, openBuffers } = bufferSearchSnapshot;
    const indexedFilePaths = new Set(files.map((file) => file.path));
    const recentFiles = filterQuickOpenRecentFiles(
      getRecentFilesOrderedByFrecency(),
      options.rootFolderPath,
      indexedFilePaths,
      options.hasLoadedFiles ?? false,
    );
    const { recentFileIndices, recentFilePaths } = indexRecentSearchFiles(
      recentFiles,
      activeBufferPath,
    );

    if (!debouncedQuery.trim()) {
      const openBufferFiles = openBuffers.slice(0, MAX_OPEN_BUFFERS_SHOWN).map((file) => ({
        name: file.name,
        path: file.path,
        isDir: false,
      }));
      const openAndActivePaths = new Set(openBufferPaths);
      if (activeBufferPath) openAndActivePaths.add(activeBufferPath);

      const recentFilesInResults = recentFiles
        .filter((file) => !openAndActivePaths.has(file.path))
        .slice(
          0,
          Math.min(MAX_RECENT_FILES_NO_QUERY, Math.max(0, MAX_RESULTS - openBufferFiles.length)),
        )
        .map(recentFileToItem);

      const excludedPaths = new Set([
        ...openAndActivePaths,
        ...recentFilesInResults.map((file) => file.path),
      ]);
      const otherCandidates: FileItem[] = [];

      for (const file of files) {
        if (excludedPaths.has(file.path)) continue;
        insertSortedLimited(
          otherCandidates,
          file,
          (a, b) => a.name.localeCompare(b.name),
          MAX_RESULTS,
        );
      }

      const otherFiles = otherCandidates.slice(
        0,
        Math.max(0, MAX_RESULTS - openBufferFiles.length - recentFilesInResults.length),
      );

      return {
        openBufferFiles,
        recentFilesInResults,
        otherFiles,
      };
    }

    const rankingContext = {
      activeBufferPath,
      openBufferPaths,
      recentFilePaths,
      recentFileIndices,
    };

    if (options.useBackendResults) return categorizeFileSearchHits(fffHits ?? [], rankingContext);

    if (fffHits && fffHits.length > 0) {
      return categorizeFileSearchHits(fffHits, rankingContext);
    }

    return categorizeFuzzyFileSearch(files, debouncedQuery, fuzzyScore, rankingContext);
  }, [
    files,
    debouncedQuery,
    bufferSearchSnapshot,
    getRecentFilesOrderedByFrecency,
    fffHits,
    options.hasLoadedFiles,
    options.rootFolderPath,
    options.useBackendResults,
  ]);

  return categorizedFiles;
};
