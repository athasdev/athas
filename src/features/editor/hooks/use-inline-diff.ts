import { useCallback, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { getFileDiffAgainstContent } from "@/features/git/api/diff";
import type { GitDiffLine } from "@/features/git/types/git";

interface InlineDiffState {
  isOpen: boolean;
  lineNumber: number;
  type: "added" | "modified" | "deleted";
  diffLines: GitDiffLine[];
}

interface UseInlineDiffReturn {
  state: InlineDiffState;
  toggle: (lineIndex: number, type: "added" | "modified" | "deleted") => Promise<void>;
  close: () => void;
}

export function useInlineDiff(filePath: string | undefined, content: string): UseInlineDiffReturn {
  const [state, setState] = useState<InlineDiffState>({
    isOpen: false,
    lineNumber: 0,
    type: "added",
    diffLines: [],
  });

  const toggle = useCallback(
    async (lineIndex: number, type: "added" | "modified" | "deleted") => {
      if (!filePath) return;

      const rootFolderPath = useFileSystemStore.getState().rootFolderPath;
      if (!rootFolderPath) return;

      if (state.isOpen && state.lineNumber === lineIndex) {
        setState({ isOpen: false, lineNumber: 0, type: "added", diffLines: [] });
        return;
      }

      const diff = await getFileDiffAgainstContent(rootFolderPath, filePath, content);
      if (diff) {
        setState({
          isOpen: true,
          lineNumber: lineIndex,
          type,
          diffLines: diff.lines,
        });
      }
    },
    [filePath, content, state.isOpen, state.lineNumber],
  );

  const close = useCallback(() => {
    setState({ isOpen: false, lineNumber: 0, type: "added", diffLines: [] });
  }, []);

  return { state, toggle, close };
}
