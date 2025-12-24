import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "./use-file-loader";
import { useFileSearch } from "./use-file-search";
import { useKeyboardNavigation } from "./use-keyboard-navigation";

export const useGlobalSearch = () => {
  const isGlobalSearchVisible = useUIState((state) => state.isGlobalSearchVisible);
  const setIsGlobalSearchVisible = useUIState((state) => state.setIsGlobalSearchVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.addOrUpdateRecentFile);
  const commandBarPreview = useSettingsStore((state) => state.settings.commandBarPreview);

  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onClose = useCallback(() => {
    setIsGlobalSearchVisible(false);
    setPreviewFilePath(null);
  }, [setIsGlobalSearchVisible]);

  // Load files
  const {
    files,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isGlobalSearchVisible);

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

  // Handle preview on hover/selection
  const handlePreviewChange = useCallback(
    (path: string | null) => {
      if (commandBarPreview) {
        setPreviewFilePath(path);
      }
    },
    [commandBarPreview],
  );

  // Keyboard navigation
  const allResults = [...openBufferFiles, ...recentFilesInResults, ...otherFiles];
  const { selectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible: isGlobalSearchVisible,
    allResults,
    onClose,
    onSelect: handleItemSelect,
  });

  // Update preview when selected index changes
  useEffect(() => {
    if (commandBarPreview && allResults.length > 0 && selectedIndex >= 0) {
      const selectedFile = allResults[selectedIndex];
      if (selectedFile && !selectedFile.isDir) {
        setPreviewFilePath(selectedFile.path);
      } else {
        setPreviewFilePath(null);
      }
    }
  }, [selectedIndex, allResults, commandBarPreview]);

  // Reset state when global search becomes visible
  useEffect(() => {
    if (isGlobalSearchVisible) {
      setQuery("");
      setPreviewFilePath(null);
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [isGlobalSearchVisible]);

  // Handle click outside
  useEffect(() => {
    if (!isGlobalSearchVisible) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest("[data-global-search]")) {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isGlobalSearchVisible, onClose]);

  return {
    isVisible: isGlobalSearchVisible,
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
    handlePreviewChange,
    previewFilePath,
    rootFolderPath: rootFolderPath || loaderRootFolder,
    showPreview: commandBarPreview,
  };
};
