import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";
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

const BUFFER_SEARCH_KEY_SEPARATOR = "\u0000";

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
  const bufferSearchKeys = useBufferStore(
    useShallow((state) =>
      state.buffers.map((buffer) =>
        [buffer.id, buffer.path, isVirtualContent(buffer) ? "1" : "0"].join(
          BUFFER_SEARCH_KEY_SEPARATOR,
        ),
      ),
    ),
  );
  const activeBufferId = useBufferStore.use.activeBufferId();
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    let activeBufferPath: string | undefined;
    const openBufferPaths = new Set(
      bufferSearchKeys.flatMap((key) => {
        const [id, path, virtualFlag] = key.split(BUFFER_SEARCH_KEY_SEPARATOR);
        if (id === activeBufferId) {
          activeBufferPath = path;
          return [];
        }
        return virtualFlag === "1" ? [] : [path];
      }),
    );

    const recentFiles = getRecentFilesOrderedByFrecency();
    const recentFilePaths = new Set(
      recentFiles.filter((rf) => rf.path !== activeBufferPath).map((rf) => rf.path),
    );
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
  }, [
    files,
    debouncedQuery,
    bufferSearchKeys,
    activeBufferId,
    getRecentFilesOrderedByFrecency,
    fffHits,
  ]);

  return categorizedFiles;
};
