import { useCallback, useState } from "react";

interface UseDiffViewStateReturn {
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  setViewMode: (mode: "unified" | "split") => void;
  setShowWhitespace: (show: boolean) => void;
}

export const useDiffViewState = (): UseDiffViewStateReturn => {
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");
  const [showWhitespace, setShowWhitespace] = useState(true);

  const stableSetViewMode = useCallback((mode: "unified" | "split") => {
    setViewMode(mode);
  }, []);

  const stableSetShowWhitespace = useCallback((show: boolean) => {
    setShowWhitespace(show);
  }, []);

  return {
    viewMode,
    showWhitespace,
    setViewMode: stableSetViewMode,
    setShowWhitespace: stableSetShowWhitespace,
  };
};
