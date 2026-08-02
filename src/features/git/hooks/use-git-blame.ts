import { useCallback, useEffect } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { isGitChangeRelevant, subscribeToGitChanges } from "../events/git-events";
import { getGitBlameCacheKey, useGitBlameStore } from "../stores/git-blame.store";
import type { GitBlameLine } from "../types/git.types";

const BLAME_REFRESH_DELAY_MS = 500;

export function useGitBlame(filePath: string | undefined, content: string) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const loadBlameForFile = useGitBlameStore((state) => state.actions.loadBlameForFile);
  const clearBlameForFile = useGitBlameStore((state) => state.actions.clearBlameForFile);
  const blameRevision = useGitBlameStore((state) => state.revision);
  const cacheKey =
    filePath && rootFolderPath ? getGitBlameCacheKey(rootFolderPath, filePath) : null;
  const blameData = useGitBlameStore((state) =>
    cacheKey && state.blameContent.get(cacheKey) === content
      ? state.blameData.get(cacheKey)
      : undefined,
  );
  useEffect(() => {
    if (!filePath || !rootFolderPath) return;

    const timeoutId = window.setTimeout(() => {
      void loadBlameForFile(rootFolderPath, filePath, content);
    }, BLAME_REFRESH_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [blameRevision, content, filePath, loadBlameForFile, rootFolderPath]);

  useEffect(() => {
    if (!filePath) return;

    const unsubscribe = subscribeToGitChanges((change) => {
      if (!isGitChangeRelevant(change, rootFolderPath, filePath)) return;
      clearBlameForFile(filePath);
    });

    return unsubscribe;
  }, [clearBlameForFile, filePath, rootFolderPath]);

  const getBlameForLine = useCallback(
    (lineNumber: number): GitBlameLine | null => {
      if (!filePath || !blameData) return null;

      const currentLine = lineNumber + 1;
      const blameLine = blameData.lines.find((line) => {
        const hunkStart = line.line_number;
        const hunkEnd = line.line_number + line.total_lines - 1;
        return currentLine >= hunkStart && currentLine <= hunkEnd;
      });
      return blameLine || null;
    },
    [filePath, blameData],
  );

  return { getBlameForLine };
}
