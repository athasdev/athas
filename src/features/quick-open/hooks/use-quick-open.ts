import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce, useDebouncedCallback } from "use-debounce";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { PREVIEW_DEBOUNCE_DELAY, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "./use-file-loader";
import { useFileSearch } from "./use-file-search";
import { useKeyboardNavigation } from "./use-keyboard-navigation";

export const useQuickOpen = () => {
  const isQuickOpenVisible = useUIState((state) => state.isQuickOpenVisible);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.addOrUpdateRecentFile);
  const quickOpenPreview = useSettingsStore((state) => state.settings.quickOpenPreview);

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onClose = useCallback(() => {
    setIsQuickOpenVisible(false);
    setPreviewFilePath(null);
  }, [setIsQuickOpenVisible]);

  const {
    files,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isQuickOpenVisible);

  const { openBufferFiles, recentFilesInResults, otherFiles } = useFileSearch(
    files,
    debouncedQuery,
  );

  const handleItemSelect = useCallback(
    (path: string) => {
      const fileName = path.split("/").pop() || path;
      addOrUpdateRecentFile(path, fileName);
      handleFileSelect(path, false);
      onClose();
    },
    [handleFileSelect, onClose, addOrUpdateRecentFile],
  );

  const debouncedSetPreview = useDebouncedCallback(
    (path: string | null) => setPreviewFilePath(path),
    PREVIEW_DEBOUNCE_DELAY,
  );

  const allResults = useMemo(
    () => [...openBufferFiles, ...recentFilesInResults, ...otherFiles],
    [openBufferFiles, recentFilesInResults, otherFiles],
  );

  const { selectedIndex, setSelectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible: isQuickOpenVisible,
    allResults,
    onClose,
    onSelect: handleItemSelect,
  });

  const handleItemHover = useCallback(
    (index: number, path: string) => {
      setSelectedIndex(index);
      if (quickOpenPreview) {
        debouncedSetPreview(path);
      }
    },
    [setSelectedIndex, quickOpenPreview, debouncedSetPreview],
  );

  useEffect(() => {
    if (!quickOpenPreview) {
      setPreviewFilePath(null);
      return;
    }
    if (allResults.length > 0 && selectedIndex >= 0) {
      const selectedFile = allResults[selectedIndex];
      debouncedSetPreview(selectedFile && !selectedFile.isDir ? selectedFile.path : null);
    }
  }, [selectedIndex, allResults, quickOpenPreview, debouncedSetPreview]);

  useEffect(() => {
    if (isQuickOpenVisible) {
      setQuery("");
      setPreviewFilePath(null);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isQuickOpenVisible]);

  return {
    isVisible: isQuickOpenVisible,
    query,
    setQuery,
    debouncedQuery,
    inputRef,
    scrollContainerRef,
    onClose,
    files,
    isLoadingFiles,
    isIndexing,
    openBufferFiles,
    recentFilesInResults,
    otherFiles,
    selectedIndex,
    handleItemSelect,
    handleItemHover,
    previewFilePath,
    rootFolderPath: rootFolderPath || loaderRootFolder,
    showPreview: quickOpenPreview,
  };
};
