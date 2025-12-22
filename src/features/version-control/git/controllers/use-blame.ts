import { useEffect } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useGitBlameStore } from "@/stores/git-blame-store";

export function useGitBlame(filePath: string | undefined) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const loadBlameForFile = useGitBlameStore((state) => state.loadBlameForFile);
  const getBlameForLine = useGitBlameStore((state) => state.getBlameForLine);

  useEffect(() => {
    if (filePath && rootFolderPath) {
      loadBlameForFile(rootFolderPath, filePath);
    }
  }, [filePath, rootFolderPath, loadBlameForFile]);

  return {
    getBlameForLine: (lineNumber: number) => {
      if (!filePath) return null;
      return getBlameForLine(filePath, lineNumber);
    },
  };
}
