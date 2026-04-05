import { useMemo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { isVirtualContent } from "@/features/panes/types/pane-content";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import {
  MAX_OTHER_FILES_NO_QUERY,
  MAX_OTHER_FILES_SHOWN,
  MAX_RECENT_FILES_NO_QUERY,
  MAX_RESULTS,
} from "../constants/limits";
import type { CategorizedFiles, FileItem } from "../types/quick-open";
import { fuzzyScore } from "../utils/fuzzy-search";

export const useFileSearch = (files: FileItem[], debouncedQuery: string) => {
  const buffers = useBufferStore.use.buffers();
  const activeBufferId = useBufferStore.use.activeBufferId();
  const getRecentFilesOrderedByFrecency = useRecentFilesStore(
    (state) => state.getRecentFilesOrderedByFrecency,
  );

  const categorizedFiles = useMemo((): CategorizedFiles => {
    const activeBuffer = buffers.find((b) => b.id === activeBufferId);
    const activeBufferPath = activeBuffer?.path;

    const openBufferPaths = new Set(
      buffers
        .filter((buffer) => buffer.id !== activeBufferId && !isVirtualContent(buffer))
        .map((buffer) => buffer.path),
    );

    const openBufferFilesData = files.filter((file) => openBufferPaths.has(file.path));

    const recentFiles = getRecentFilesOrderedByFrecency();
    const recentFilePaths = new Set(
      recentFiles.filter((rf) => rf.path !== activeBufferPath).map((rf) => rf.path),
    );
    const recentFileIndices = new Map(recentFiles.map((rf, index) => [rf.path, index]));

    if (!debouncedQuery.trim()) {
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
            file.path !== activeBufferPath,
        )
        .slice(0, MAX_OTHER_FILES_NO_QUERY)
        .sort((a, b) => a.name.localeCompare(b.name));

      return {
        openBufferFiles: openBufferFilesData,
        recentFilesInResults: recent.slice(0, MAX_RECENT_FILES_NO_QUERY),
        otherFiles: others.slice(0, MAX_RESULTS - openBufferFilesData.length - recent.length),
      };
    }

    const scoredFiles = files
      .map((file) => {
        const nameScore = fuzzyScore(file.name, debouncedQuery);
        const pathScore = fuzzyScore(file.path, debouncedQuery);
        return { file, score: Math.max(nameScore, pathScore) };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
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
          file.path !== activeBufferPath,
      )
      .map(({ file }) => file);

    return {
      openBufferFiles: openBuffers.slice(0, MAX_RESULTS),
      recentFilesInResults: recent.slice(0, MAX_RESULTS - openBuffers.length),
      otherFiles: others.slice(0, MAX_OTHER_FILES_SHOWN - openBuffers.length - recent.length),
    };
  }, [files, debouncedQuery, buffers, activeBufferId, getRecentFilesOrderedByFrecency]);

  return categorizedFiles;
};
