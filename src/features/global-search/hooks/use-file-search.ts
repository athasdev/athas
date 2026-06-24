import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import {
  MAX_OPEN_BUFFERS_SHOWN,
  MAX_OTHER_FILES_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
  MAX_RESULTS,
} from "../constants/limits";
import type { CategorizedFiles, FileItem, SearchResult } from "../types/global-search.types";
import type { FffSearchHit } from "../lib/rust-api/search";
import { fuzzyScore } from "../utils/fuzzy-search";

function insertSortedLimited<T>(
  items: T[],
  candidate: T,
  compare: (a: T, b: T) => number,
  limit: number,
) {
  if (limit <= 0) return;

  const insertIndex = items.findIndex((item) => compare(candidate, item) < 0);
  if (insertIndex === -1) {
    if (items.length < limit) {
      items.push(candidate);
    }
    return;
  }

  items.splice(insertIndex, 0, candidate);
  if (items.length > limit) {
    items.pop();
  }
}

export const useFileSearch = (
  files: FileItem[],
  debouncedQuery: string,
  fffHits: FffSearchHit[] | null = null,
) => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.getRecentFilesOrderedByFrecency,
  );

  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const recentFiles = getRecentFilesOrderedByFrecency();

  const categorizedFiles = useMemo((): CategorizedFiles => {
    // Get open buffer paths (excluding active buffer) - Use Set for O(1) lookups
    const openBufferPaths = new Set(
      buffers
        .filter((buffer) => buffer.id !== activeBufferId && !isVirtualContent(buffer))
        .map((buffer) => buffer.path),
    );

    // Get recent file paths (excluding active buffer) - Use Set for O(1) lookups
    const recentFilePaths = new Set(
      recentFiles
        .filter((rf) => !activeBuffer || rf.path !== activeBuffer.path)
        .map((rf) => rf.path),
    );

    // Create a Map for recent file indices for O(1) lookups
    const recentFileIndices = new Map(recentFiles.map((rf, index) => [rf.path, index]));

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

        if (!activeBuffer || file.path !== activeBuffer.path) {
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
      if (aIsOpen && !bIsOpen) return -1;
      if (!aIsOpen && bIsOpen) return 1;

      const aIsRecent = recentFilePaths.has(a.file.path);
      const bIsRecent = recentFilePaths.has(b.file.path);
      if (aIsRecent && !bIsRecent) return -1;
      if (!aIsRecent && bIsRecent) return 1;

      if (aIsRecent && bIsRecent) {
        const aIndex = recentFileIndices.get(a.file.path) ?? Number.MAX_VALUE;
        const bIndex = recentFileIndices.get(b.file.path) ?? Number.MAX_VALUE;
        return aIndex - bIndex;
      }

      return a.file.name.localeCompare(b.file.name);
    };

    const scoredFiles: SearchResult[] =
      fffHits && fffHits.length > 0
        ? fffHits.map((hit) => ({
            file: { name: hit.name, path: hit.path, isDir: false },
            score: hit.score,
          }))
        : [];

    if (!fffHits || fffHits.length === 0) {
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
        } else if (!activeBuffer || file.path !== activeBuffer.path) {
          insertSortedLimited(
            otherCandidates,
            candidate,
            compareScoredFiles,
            MAX_OTHER_FILES_SHOWN,
          );
        }
      }

      scoredFiles.push(...openCandidates, ...recentCandidates, ...otherCandidates);
    }

    const openBuffers = scoredFiles
      .filter(({ file }) => openBufferPaths.has(file.path))
      .map(({ file }) => file);

    const recent = scoredFiles
      .filter(({ file }) => recentFilePaths.has(file.path) && !openBufferPaths.has(file.path))
      .map(({ file }) => file);

    const others = scoredFiles
      .filter(
        ({ file }) =>
          !recentFilePaths.has(file.path) &&
          !openBufferPaths.has(file.path) &&
          (!activeBuffer || file.path !== activeBuffer.path),
      )
      .map(({ file }) => file);

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
  }, [files, debouncedQuery, buffers, activeBufferId, recentFiles, activeBuffer, fffHits]);

  return categorizedFiles;
};
