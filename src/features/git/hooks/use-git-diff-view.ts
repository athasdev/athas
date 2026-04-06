import { useCallback, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";

interface UseDiffViewStateReturn {
  viewMode: "unified" | "split";
  showWhitespace: boolean;
  setViewMode: (mode: "unified" | "split") => void;
  setShowWhitespace: (show: boolean) => void;
}

export const useDiffViewState = (): UseDiffViewStateReturn => {
  const defaultViewMode = useSettingsStore((state) => state.settings.gitDefaultDiffView);
  const [viewMode, setViewMode] = useState<"unified" | "split">(defaultViewMode);
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
