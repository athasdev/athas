import {
  MAX_FILE_SEARCH_RESULTS,
  MAX_OTHER_FILES_SHOWN,
} from "@/features/file-search/constants/file-search-limits";
import type { FffSearchHit } from "@/features/file-search/lib/file-search-api";
import type {
  CategorizedFiles,
  FileItem,
  ScoredFile,
} from "@/features/file-search/types/file-search.types";
import { insertSortedLimited } from "@/features/file-search/utils/sorted-search-results";

interface FileSearchRankingContext {
  activeBufferPath?: string;
  openBufferPaths: ReadonlySet<string>;
  recentFilePaths: ReadonlySet<string>;
  recentFileIndices: ReadonlyMap<string, number>;
}

export function indexRecentSearchFiles(
  files: readonly { path: string }[],
  activeBufferPath?: string,
) {
  const recentFilePaths = new Set<string>();
  const recentFileIndices = new Map<string, number>();

  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    if (!file) continue;
    recentFileIndices.set(file.path, index);
    if (file.path !== activeBufferPath) recentFilePaths.add(file.path);
  }

  return { recentFileIndices, recentFilePaths };
}

function compareScoredFiles(
  left: ScoredFile,
  right: ScoredFile,
  context: FileSearchRankingContext,
) {
  if (right.score !== left.score) return right.score - left.score;

  const leftIsOpen = context.openBufferPaths.has(left.file.path);
  const rightIsOpen = context.openBufferPaths.has(right.file.path);
  if (leftIsOpen !== rightIsOpen) return leftIsOpen ? -1 : 1;

  const leftIsRecent = context.recentFilePaths.has(left.file.path);
  const rightIsRecent = context.recentFilePaths.has(right.file.path);
  if (leftIsRecent !== rightIsRecent) return leftIsRecent ? -1 : 1;

  if (leftIsRecent && rightIsRecent) {
    const leftIndex = context.recentFileIndices.get(left.file.path) ?? Number.MAX_VALUE;
    const rightIndex = context.recentFileIndices.get(right.file.path) ?? Number.MAX_VALUE;
    return leftIndex - rightIndex;
  }

  return left.file.name.localeCompare(right.file.name);
}

function finalizeCategorizedFiles(
  openBufferFiles: FileItem[],
  recentFilesInResults: FileItem[],
  otherFiles: FileItem[],
): CategorizedFiles {
  const visibleOpenBuffers = openBufferFiles.slice(0, MAX_FILE_SEARCH_RESULTS);
  const visibleRecentFiles = recentFilesInResults.slice(
    0,
    Math.max(0, MAX_FILE_SEARCH_RESULTS - visibleOpenBuffers.length),
  );
  const visibleOtherFiles = otherFiles.slice(
    0,
    Math.max(0, MAX_OTHER_FILES_SHOWN - visibleOpenBuffers.length - visibleRecentFiles.length),
  );

  return {
    openBufferFiles: visibleOpenBuffers,
    recentFilesInResults: visibleRecentFiles,
    otherFiles: visibleOtherFiles,
  };
}

export function categorizeFileSearchHits(
  hits: readonly FffSearchHit[],
  context: FileSearchRankingContext,
): CategorizedFiles {
  const openBufferFiles: FileItem[] = [];
  const recentFilesInResults: FileItem[] = [];
  const otherFiles: FileItem[] = [];

  for (const hit of hits) {
    const file = { name: hit.name, path: hit.path, isDir: false };
    if (context.openBufferPaths.has(file.path)) openBufferFiles.push(file);
    else if (context.recentFilePaths.has(file.path)) recentFilesInResults.push(file);
    else if (file.path !== context.activeBufferPath) otherFiles.push(file);
  }

  return finalizeCategorizedFiles(openBufferFiles, recentFilesInResults, otherFiles);
}

export function categorizeFuzzyFileSearch(
  files: readonly FileItem[],
  query: string,
  scoreText: (text: string, query: string) => number,
  context: FileSearchRankingContext,
): CategorizedFiles {
  const openCandidates: ScoredFile[] = [];
  const recentCandidates: ScoredFile[] = [];
  const otherCandidates: ScoredFile[] = [];
  const compare = (left: ScoredFile, right: ScoredFile) => compareScoredFiles(left, right, context);

  for (const file of files) {
    const score = Math.max(scoreText(file.name, query), scoreText(file.path, query));
    if (score <= 0) continue;

    const candidate = { file, score };
    if (context.openBufferPaths.has(file.path)) {
      insertSortedLimited(openCandidates, candidate, compare, MAX_FILE_SEARCH_RESULTS);
    } else if (context.recentFilePaths.has(file.path)) {
      insertSortedLimited(recentCandidates, candidate, compare, MAX_FILE_SEARCH_RESULTS);
    } else if (file.path !== context.activeBufferPath) {
      insertSortedLimited(otherCandidates, candidate, compare, MAX_OTHER_FILES_SHOWN);
    }
  }

  return finalizeCategorizedFiles(
    openCandidates.map(({ file }) => file),
    recentCandidates.map(({ file }) => file),
    otherCandidates.map(({ file }) => file),
  );
}
