import { useCallback, useEffect } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import type { GitBlameLine } from "../types/git";

export function useGitBlame(filePath: string | undefined) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const loadBlameForFile = useGitBlameStore((state) => state.loadBlameForFile);
  // Subscribe to the actual blame data for this file so component re-renders when it loads
  const blameData = useGitBlameStore((state) =>
    filePath ? state.blameData.get(filePath) : undefined,
  );

  useEffect(() => {
    if (filePath && rootFolderPath) {
      loadBlameForFile(rootFolderPath, filePath);
    }
  }, [filePath, rootFolderPath, loadBlameForFile]);

  const getBlameForLine = useCallback(
    (lineNumber: number): GitBlameLine | null => {
      if (!filePath || !blameData) return null;

      // Find the blame line that matches the line number
      // Git blame line numbers are 1-based, editor line numbers are 0-based
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
