import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getOpenBufferSearchSnapshot } from "@/features/editor/utils/open-buffer-search-snapshot";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import type { RecentFile } from "@/features/file-system/types/recent-files.types";
import type { FffSearchHit } from "@/features/file-search/lib/file-search-api";
import { pathStartsWithRoot } from "@/utils/path-helpers";
import {
  MAX_OPEN_BUFFERS_SHOWN,
  MAX_OTHER_FILES_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
  MAX_RESULTS,
} from "../constants/limits";
import type { CategorizedFiles, FileItem, SearchResult } from "../types/quick-open.types";
import { fuzzyScore } from "../utils/fuzzy-search";

interface FileSearchOptions {
  rootFolderPath?: string | null;
  useBackendResults?: boolean;
}

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

function recentFileToItem(file: RecentFile): FileItem {
  return {
    name: file.name,
    path: file.path,
    isDir: false,
  };
}

function isRecentFileInWorkspace(file: RecentFile, rootFolderPath: string | null | undefined) {
  if (!rootFolderPath) return true;
  if (file.workspacePath === rootFolderPath) return true;
  return pathStartsWithRoot(file.path, rootFolderPath);
}

function categorizeBackendHits(
  hits: readonly FffSearchHit[],
  activeBufferPath: string | undefined,
  openBufferPaths: ReadonlySet<string>,
  recentFilePaths: ReadonlySet<string>,
): CategorizedFiles {
  const openBuffers: FileItem[] = [];
  const recent: FileItem[] = [];
  const others: FileItem[] = [];

  for (const hit of hits) {
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

  const openBufferFiles = openBuffers.slice(0, MAX_RESULTS);
  const recentFilesInResults = recent.slice(0, Math.max(0, MAX_RESULTS - openBufferFiles.length));
  const otherFiles = others.slice(
    0,
    Math.max(0, MAX_OTHER_FILES_SHOWN - openBufferFiles.length - recentFilesInResults.length),
  );

  return {
    openBufferFiles,
    recentFilesInResults,
    otherFiles,
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
    (state) => state.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    const { activeBufferPath, openBufferPaths, openBuffers } = bufferSearchSnapshot;
    const recentFiles = getRecentFilesOrderedByFrecency().filter((file) =>
      isRecentFileInWorkspace(file, options.rootFolderPath),
    );
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

    if (options.useBackendResults) {
      return categorizeBackendHits(
        fffHits ?? [],
        activeBufferPath,
        openBufferPaths,
        recentFilePaths,
      );
    }

    if (fffHits && fffHits.length > 0) {
      return categorizeBackendHits(fffHits, activeBufferPath, openBufferPaths, recentFilePaths);
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

    const openBufferFiles = openCandidates.slice(0, MAX_RESULTS).map(({ file }) => file);
    const recentFilesInResults = recentCandidates
      .slice(0, Math.max(0, MAX_RESULTS - openBufferFiles.length))
      .map(({ file }) => file);
    const otherFiles = otherCandidates
      .slice(
        0,
        Math.max(0, MAX_OTHER_FILES_SHOWN - openBufferFiles.length - recentFilesInResults.length),
      )
      .map(({ file }) => file);

    return {
      openBufferFiles,
      recentFilesInResults,
      otherFiles,
    };
  }, [
    files,
    debouncedQuery,
    bufferSearchSnapshot,
    getRecentFilesOrderedByFrecency,
    fffHits,
    options.rootFolderPath,
    options.useBackendResults,
  ]);

  return categorizedFiles;
};
