import { useCallback, useState } from "react";

interface UseDiffViewStateReturn {
  collapsedHunks: Set<number>;
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  setViewMode: (mode: "unified" | "split") => void;
  setShowWhitespace: (show: boolean) => void;
  toggleHunkCollapse: (hunkId: number) => void;
  isHunkCollapsed: (hunkId: number) => boolean;
}

export const useDiffViewState = (): UseDiffViewStateReturn => {
  const [collapsedHunks, setCollapsedHunks] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(true);

  const toggleHunkCollapse = useCallback((hunkId: number) => {
    setCollapsedHunks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(hunkId)) {
        newSet.delete(hunkId);
      } else {
        newSet.add(hunkId);
      }
      return newSet;
    });
  }, []);

  const isHunkCollapsed = useCallback(
    (hunkId: number) => {
      return collapsedHunks.has(hunkId);
    },
    [collapsedHunks],
  );

  return {
    collapsedHunks,
    viewMode,
    showWhitespace,
    setViewMode,
    setShowWhitespace,
    toggleHunkCollapse,
    isHunkCollapsed,
  };
};
