import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getOpenBufferSearchSnapshot } from "@/features/editor/utils/open-buffer-search-snapshot";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
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
import { fuzzyScore } from "../utils/fuzzy-search";

export const useFileSearch = (
  files: FileItem[],
  debouncedQuery: string,
  fffHits: FffSearchHit[] | null = null,
) => {
  const bufferSearchSnapshot = useBufferStore((state) =>
    getOpenBufferSearchSnapshot(state.buffers, state.activeBufferId),
  );
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.actions.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    const { activeBufferPath, openBufferPaths } = bufferSearchSnapshot;

    const recentFiles = getRecentFilesOrderedByFrecency();
    const { recentFileIndices, recentFilePaths } = indexRecentSearchFiles(
      recentFiles,
      activeBufferPath,
    );

    if (!debouncedQuery.trim()) {
      const openBuffersShown: FileItem[] = [];
      const recentCandidates: FileItem[] = [];
      const otherCandidates: FileItem[] = [];

      for (const file of files) {
        if (openBufferPaths.has(file.path)) {
          if (openBuffersShown.length < MAX_OPEN_BUFFERS_SHOWN) {
            openBuffersShown.push(file);
          }
          continue;
        }

        if (recentFilePaths.has(file.path)) {
          insertSortedLimited(
            recentCandidates,
            file,
            (a, b) =>
              (recentFileIndices.get(a.path) ?? Number.MAX_VALUE) -
              (recentFileIndices.get(b.path) ?? Number.MAX_VALUE),
            MAX_RECENT_FILES_NO_QUERY,
          );
          continue;
        }

        if (file.path !== activeBufferPath) {
          insertSortedLimited(
            otherCandidates,
            file,
            (a, b) => a.name.localeCompare(b.name),
            MAX_RESULTS,
          );
        }
      }

      const recentFilesShown = recentCandidates.slice(
        0,
        Math.min(MAX_RECENT_FILES_NO_QUERY, Math.max(0, MAX_RESULTS - openBuffersShown.length)),
      );
      const otherFilesShown = otherCandidates.slice(
        0,
        Math.max(0, MAX_RESULTS - openBuffersShown.length - recentFilesShown.length),
      );

      return {
        openBufferFiles: openBuffersShown,
        recentFilesInResults: recentFilesShown,
        otherFiles: otherFilesShown,
      };
    }

    const rankingContext = {
      activeBufferPath,
      openBufferPaths,
      recentFilePaths,
      recentFileIndices,
    };

    if (fffHits && fffHits.length > 0) {
      return categorizeFileSearchHits(fffHits, rankingContext);
    }

    return categorizeFuzzyFileSearch(files, debouncedQuery, fuzzyScore, rankingContext);
  }, [files, debouncedQuery, bufferSearchSnapshot, getRecentFilesOrderedByFrecency, fffHits]);

  return categorizedFiles;
};
