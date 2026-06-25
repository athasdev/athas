import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getOpenBufferSearchSnapshot } from "@/features/editor/utils/open-buffer-search-snapshot";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import {
  MAX_OPEN_BUFFERS_SHOWN,
  MAX_OTHER_FILES_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
  MAX_RESULTS,
} from "../constants/limits";
import type { FffSearchHit } from "@/features/global-search/lib/rust-api/search";
import type { CategorizedFiles, FileItem, SearchResult } from "../types/quick-open.types";
import { fuzzyScore } from "../utils/fuzzy-search";

function insertSortedLimited<T>(
  items: T[],
  candidate: T,
  compare: (a: T, b: T) => number,
  limit: number,
) {
  if (limit <= 0) return;

  let low = 0;
  let high = items.length;
  while (low < high) {
    const midpoint = (low + high) >> 1;
    if (compare(candidate, items[midpoint]) < 0) {
      high = midpoint;
    } else {
      low = midpoint + 1;
    }
  }

  if (low >= limit && items.length >= limit) {
    return;
  }

  items.splice(low, 0, candidate);
  if (items.length > limit) {
    items.pop();
  }
}

export const useFileSearch = (
  files: FileItem[],
  debouncedQuery: string,
  fffHits: FffSearchHit[] | null = null,
) => {
  const bufferSearchSnapshot = useBufferStore((state) =>
    getOpenBufferSearchSnapshot(state.buffers, state.activeBufferId),
  );
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    const { activeBufferPath, openBufferPaths } = bufferSearchSnapshot;

    const recentFiles = getRecentFilesOrderedByFrecency();
    const recentFilePaths = new Set<string>();
    const recentFileIndices = new Map<string, number>();
    for (let index = 0; index < recentFiles.length; index++) {
      const recentFile = recentFiles[index];
      if (!recentFile) continue;
      recentFileIndices.set(recentFile.path, index);
      if (recentFile.path !== activeBufferPath) {
        recentFilePaths.add(recentFile.path);
      }
    }

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

    const compareScoredFiles = (a: SearchResult, b: SearchResult) => {
      if (b.score !== a.score) return b.score - a.score;

      const aIsOpen = openBufferPaths.has(a.file.path);
      const bIsOpen = openBufferPaths.has(b.file.path);
      if (aIsOpen !== bIsOpen) return aIsOpen ? -1 : 1;

      const aIsRecent = recentFilePaths.has(a.file.path);
      const bIsRecent = recentFilePaths.has(b.file.path);
      if (aIsRecent !== bIsRecent) return aIsRecent ? -1 : 1;

      if (aIsRecent && bIsRecent) {
        const aIndex = recentFileIndices.get(a.file.path) ?? Number.MAX_VALUE;
        const bIndex = recentFileIndices.get(b.file.path) ?? Number.MAX_VALUE;
        return aIndex - bIndex;
      }

      return a.file.name.localeCompare(b.file.name);
    };

    if (fffHits && fffHits.length > 0) {
      const openBuffers: FileItem[] = [];
      const recent: FileItem[] = [];
      const others: FileItem[] = [];

      for (const hit of fffHits) {
        const file = { name: hit.name, path: hit.path, isDir: false };
        if (openBufferPaths.has(file.path)) {
          if (openBuffers.length < MAX_RESULTS) {
            openBuffers.push(file);
          }
        } else if (recentFilePaths.has(file.path)) {
          if (recent.length < MAX_RESULTS) {
            recent.push(file);
          }
        } else if (file.path !== activeBufferPath && others.length < MAX_OTHER_FILES_SHOWN) {
          others.push(file);
        }
      }

      const openBuffersShown = openBuffers.slice(0, MAX_RESULTS);
      const recentFilesShown = recent.slice(0, Math.max(0, MAX_RESULTS - openBuffersShown.length));
      const otherFilesShown = others.slice(
        0,
        Math.max(0, MAX_OTHER_FILES_SHOWN - openBuffersShown.length - recentFilesShown.length),
      );

      return {
        openBufferFiles: openBuffersShown,
        recentFilesInResults: recentFilesShown,
        otherFiles: otherFilesShown,
      };
    }

    const openCandidates: SearchResult[] = [];
    const recentCandidates: SearchResult[] = [];
    const otherCandidates: SearchResult[] = [];

    for (const file of files) {
      const nameScore = fuzzyScore(file.name, debouncedQuery);
      const pathScore = fuzzyScore(file.path, debouncedQuery);
      const score = Math.max(nameScore, pathScore);
      if (score <= 0) continue;

      const candidate = { file, score };
      if (openBufferPaths.has(file.path)) {
        insertSortedLimited(openCandidates, candidate, compareScoredFiles, MAX_RESULTS);
      } else if (recentFilePaths.has(file.path)) {
        insertSortedLimited(recentCandidates, candidate, compareScoredFiles, MAX_RESULTS);
      } else if (file.path !== activeBufferPath) {
        insertSortedLimited(otherCandidates, candidate, compareScoredFiles, MAX_OTHER_FILES_SHOWN);
      }
    }

    const openBuffersShown = openCandidates.slice(0, MAX_RESULTS).map(({ file }) => file);
    const recentFilesShown = recentCandidates
      .slice(0, Math.max(0, MAX_RESULTS - openBuffersShown.length))
      .map(({ file }) => file);
    const otherFilesShown = otherCandidates
      .slice(
        0,
        Math.max(0, MAX_OTHER_FILES_SHOWN - openBuffersShown.length - recentFilesShown.length),
      )
      .map(({ file }) => file);

    return {
      openBufferFiles: openBuffersShown,
      recentFilesInResults: recentFilesShown,
      otherFiles: otherFilesShown,
    };
  }, [files, debouncedQuery, bufferSearchSnapshot, getRecentFilesOrderedByFrecency, fffHits]);

  return categorizedFiles;
};
