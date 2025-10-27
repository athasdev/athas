import { useMemo } from "react";
import { useRecentFilesStore } from "@/file-system/controllers/recent-files-store";
import { useBufferStore } from "@/stores/buffer-store";
import {
  MAX_OTHER_FILES_NO_QUERY,
  MAX_OTHER_FILES_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
  MAX_RESULTS,
  MAX_SEARCH_FILES,
} from "../constants/limits";
import type { CategorizedFiles, FileItem } from "../models/types";
import { fuzzyScore } from "../utils/fuzzy-search";

export const useFileSearch = (files: FileItem[], debouncedQuery: string) => {
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
        .filter((buffer) => buffer.id !== activeBufferId && !buffer.isVirtual)
        .map((buffer) => buffer.path),
    );

    const openBufferFilesData = files.filter((file) => openBufferPaths.has(file.path));

    // Get recent file paths (excluding active buffer) - Use Set for O(1) lookups
    const recentFilePaths = new Set(
      recentFiles
        .filter((rf) => !activeBuffer || rf.path !== activeBuffer.path)
        .map((rf) => rf.path),
    );

    // Create a Map for recent file indices for O(1) lookups
    const recentFileIndices = new Map(recentFiles.map((rf, index) => [rf.path, index]));

    if (!debouncedQuery.trim()) {
      // No search query - show open buffers, then recent files by frecency, then alphabetical
      const recent = files
        .filter((file) => recentFilePaths.has(file.path) && !openBufferPaths.has(file.path))
        .sort((a, b) => {
          const aIndex = recentFileIndices.get(a.path) ?? Number.MAX_VALUE;
          const bIndex = recentFileIndices.get(b.path) ?? Number.MAX_VALUE;
          return aIndex - bIndex;
        });

      const others = files
        .filter(
          (file) =>
            !recentFilePaths.has(file.path) &&
            !openBufferPaths.has(file.path) &&
            (!activeBuffer || file.path !== activeBuffer.path),
        )
        .slice(0, MAX_OTHER_FILES_NO_QUERY)
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        openBufferFiles: openBufferFilesData,
        recentFilesInResults: recent.slice(0, MAX_RECENT_FILES_NO_QUERY),
        otherFiles: others.slice(0, MAX_RESULTS - openBufferFilesData.length - recent.length),
      };
    }

    // With search query - use fuzzy search with performance optimizations
    const maxSearchFiles = Math.min(MAX_SEARCH_FILES, files.length);
    const scoredFiles = files
      .slice(0, maxSearchFiles)
      .map((file) => {
        const nameScore = fuzzyScore(file.name, debouncedQuery);
        const pathScore = fuzzyScore(file.path, debouncedQuery);
        const score = Math.max(nameScore, pathScore);
        return { file, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        // First sort by score (highest first)
        if (b.score !== a.score) return b.score - a.score;

        // Then prioritize open buffers
        const aIsOpen = openBufferPaths.has(a.file.path);
        const bIsOpen = openBufferPaths.has(b.file.path);
        if (aIsOpen && !bIsOpen) return -1;
        if (!aIsOpen && bIsOpen) return 1;

        // Then prioritize recent files by frecency
        const aIsRecent = recentFilePaths.has(a.file.path);
        const bIsRecent = recentFilePaths.has(b.file.path);
        if (aIsRecent && !bIsRecent) return -1;
        if (!aIsRecent && bIsRecent) return 1;

        if (aIsRecent && bIsRecent) {
          const aIndex = recentFileIndices.get(a.file.path) ?? Number.MAX_VALUE;
          const bIndex = recentFileIndices.get(b.file.path) ?? Number.MAX_VALUE;
          return aIndex - bIndex;
        }

        // Finally sort alphabetically
        return a.file.name.localeCompare(b.file.name);
      });

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

    return {
      openBufferFiles: openBuffers.slice(0, MAX_RESULTS),
      recentFilesInResults: recent.slice(0, MAX_RESULTS - openBuffers.length),
      otherFiles: others.slice(0, MAX_OTHER_FILES_SHOWN - openBuffers.length - recent.length),
    };
  }, [files, debouncedQuery, buffers, activeBufferId, recentFiles, activeBuffer]);

  return categorizedFiles;
};
