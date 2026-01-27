import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useUIState } from "@/stores/ui-state-store";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "./use-file-loader";
import { useFileSearch } from "./use-file-search";
import { useKeyboardNavigation } from "./use-keyboard-navigation";

export const useCommandBar = () => {
  const isCommandBarVisible = useUIState((state) => state.isCommandBarVisible);
  const setIsCommandBarVisible = useUIState((state) => state.setIsCommandBarVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.addOrUpdateRecentFile);

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const inputRef = useRef<HTMLInputElement>(null);

  const onClose = useCallback(() => {
    setIsCommandBarVisible(false);
  }, [setIsCommandBarVisible]);

  // Load files
  const {
    files,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isCommandBarVisible);

  // Search and categorize files
  const { openBufferFiles, recentFilesInResults, otherFiles } = useFileSearch(
    files,
    debouncedQuery,
  );

  // Handle file selection
  const handleItemSelect = useCallback(
    (path: string) => {
      const fileName = path.split("/").pop() || path;
      addOrUpdateRecentFile(path, fileName);
      handleFileSelect(path, false);
      onClose();
    },
    [handleFileSelect, onClose, addOrUpdateRecentFile],
  );

  // Keyboard navigation
  const allResults = [...openBufferFiles, ...recentFilesInResults, ...otherFiles];
  const { selectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible: isCommandBarVisible,
    allResults,
    onClose,
    onSelect: handleItemSelect,
  });

  // Reset state when command bar becomes visible
  useEffect(() => {
    if (isCommandBarVisible) {
      setQuery("");
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isCommandBarVisible]);

  return {
    isVisible: isCommandBarVisible,
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
    rootFolderPath: rootFolderPath || loaderRootFolder,
  };
};
