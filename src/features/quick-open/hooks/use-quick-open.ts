import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce, useDebouncedCallback } from "use-debounce";
import { editorAPI } from "@/features/editor/extensions/api";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { useCenterCursor } from "@/features/editor/hooks/use-center-cursor";
import { PREVIEW_DEBOUNCE_DELAY, SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "./use-file-loader";
import { useFileSearch } from "./use-file-search";
import { useKeyboardNavigation } from "./use-keyboard-navigation";
import { type SymbolItem, useSymbolSearch } from "./use-symbol-search";

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
  const { centerCursorInViewport } = useCenterCursor();

  // Detect symbol mode (query starts with @)
  const isSymbolMode = query.startsWith("@");

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
    isSymbolMode ? "" : debouncedQuery,
  );

  // Symbol search (only active in @ mode)
  const { symbols, isLoading: isLoadingSymbols } = useSymbolSearch(query, isSymbolMode);

  const handleSymbolSelect = useCallback(
    (symbol: SymbolItem) => {
      onClose();

      // Navigate to symbol position
      setTimeout(() => {
        const lines = editorAPI.getLines();
        let offset = 0;
        for (let i = 0; i < symbol.line; i++) {
          offset += (lines[i]?.length || 0) + 1;
        }
        offset += symbol.character;

        editorAPI.setCursorPosition({
          line: symbol.line,
          column: symbol.character,
          offset,
        });

        requestAnimationFrame(() => {
          centerCursorInViewport(symbol.line);
        });
      }, 50);
    },
    [onClose, centerCursorInViewport],
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

  // In symbol mode, keyboard nav operates on symbols; in file mode, on files
  const symbolSelectAdapter = useCallback(
    (path: string) => {
      const index = symbols.findIndex((s) => `${s.name}:${s.line}` === path);
      if (index >= 0) handleSymbolSelect(symbols[index]);
    },
    [symbols, handleSymbolSelect],
  );

  const symbolResultsAsFiles = useMemo(
    () =>
      symbols.map((s) => ({
        name: s.name,
        path: `${s.name}:${s.line}`,
        isDir: false,
      })),
    [symbols],
  );

  const { selectedIndex, setSelectedIndex, scrollContainerRef } = useKeyboardNavigation({
    isVisible: isQuickOpenVisible,
    allResults: isSymbolMode ? symbolResultsAsFiles : allResults,
    onClose,
    onSelect: isSymbolMode ? symbolSelectAdapter : handleItemSelect,
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
    setSelectedIndex,
    previewFilePath,
    rootFolderPath: rootFolderPath || loaderRootFolder,
    showPreview: quickOpenPreview && !isSymbolMode,
    isSymbolMode,
    symbols,
    isLoadingSymbols,
    handleSymbolSelect,
  };
};
