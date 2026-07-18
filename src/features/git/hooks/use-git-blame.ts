import { useCallback, useEffect } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useGitBlameStore } from "../stores/git-blame.store";
import type { GitBlameLine } from "../types/git.types";

const BLAME_REFRESH_DELAY_MS = 500;

export function useGitBlame(filePath: string | undefined, content: string) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const loadBlameForFile = useGitBlameStore((state) => state.actions.loadBlameForFile);
  const clearBlameForFile = useGitBlameStore((state) => state.actions.clearBlameForFile);
  const blameRevision = useGitBlameStore((state) => state.revision);
  const blameData = useGitBlameStore((state) =>
    filePath && state.blameContent.get(filePath) === content
      ? state.blameData.get(filePath)
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

    const handleGitStatusUpdate = (event: Event) => {
      const updatedFilePath = (event as CustomEvent<{ filePath?: string }>).detail?.filePath;
      if (updatedFilePath && updatedFilePath !== filePath) return;

      clearBlameForFile(filePath);
    };

    window.addEventListener("git-status-updated", handleGitStatusUpdate);
    window.addEventListener("git-status-changed", handleGitStatusUpdate);
    return () => {
      window.removeEventListener("git-status-updated", handleGitStatusUpdate);
      window.removeEventListener("git-status-changed", handleGitStatusUpdate);
    };
  }, [clearBlameForFile, filePath]);

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
