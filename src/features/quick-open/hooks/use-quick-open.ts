import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { editorAPI } from "@/features/editor/extensions/api";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { canUseNativeFileSearch } from "@/features/global-search/utils/file-search-paths";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useCenterCursor } from "@/features/editor/hooks/use-center-cursor";
import { calculateOffsetFromContentPosition } from "@/features/editor/utils/position";
import { getBaseName } from "@/utils/path-helpers";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFffSearch } from "./use-fff-search";
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
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const inputRef = useRef<HTMLInputElement>(null);
  const { centerCursorInViewport } = useCenterCursor();

  // Detect symbol mode (query starts with @)
  const isSymbolMode = query.startsWith("@");
  const useBackendFileSearch = canUseNativeFileSearch(rootFolderPath);

  const onClose = useCallback(() => {
    setIsQuickOpenVisible(false);
  }, [setIsQuickOpenVisible]);

  const {
    files,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isQuickOpenVisible && !useBackendFileSearch);

  const { hits: fffHits, isSearching: isFffSearching } = useFffSearch(
    debouncedQuery,
    isQuickOpenVisible && !isSymbolMode,
    rootFolderPath,
  );

  const { openBufferFiles, recentFilesInResults, otherFiles } = useFileSearch(
    files,
    isSymbolMode ? "" : debouncedQuery,
    isSymbolMode ? null : fffHits,
    {
      rootFolderPath,
      useBackendResults: useBackendFileSearch && !isSymbolMode && debouncedQuery.trim().length > 0,
    },
  );

  // Symbol search (only active in @ mode)
  const { symbols, isLoading: isLoadingSymbols } = useSymbolSearch(query, isSymbolMode);

  const handleSymbolSelect = useCallback(
    (symbol: SymbolItem) => {
      onClose();

      // Navigate to symbol position
      setTimeout(() => {
        const offset = calculateOffsetFromContentPosition(
          editorAPI.getContent(),
          symbol.line,
          symbol.character,
        );

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
      const fileName = getBaseName(path, path);
      addOrUpdateRecentFile(path, fileName, {
        workspacePath: rootFolderPath ?? null,
        external: false,
      });
      handleFileSelect(path, false);
      onClose();
    },
    [handleFileSelect, onClose, addOrUpdateRecentFile, rootFolderPath],
  );

  const allResults = useMemo(
    () => [...openBufferFiles, ...recentFilesInResults, ...otherFiles],
    [openBufferFiles, recentFilesInResults, otherFiles],
  );

  // In symbol mode, keyboard nav operates on symbols; in file mode, on files
  const { symbolResultsAsFiles, symbolByPath } = useMemo(() => {
    const nextSymbolResultsAsFiles = [];
    const nextSymbolByPath = new Map<string, SymbolItem>();
    for (const symbol of symbols) {
      const path = `${symbol.name}:${symbol.line}`;
      nextSymbolResultsAsFiles.push({
        name: symbol.name,
        path,
        isDir: false,
      });
      nextSymbolByPath.set(path, symbol);
    }

    return {
      symbolResultsAsFiles: nextSymbolResultsAsFiles,
      symbolByPath: nextSymbolByPath,
    };
  }, [symbols]);

  const symbolSelectAdapter = useCallback(
    (path: string) => {
      const symbol = symbolByPath.get(path);
      if (symbol) handleSymbolSelect(symbol);
    },
    [symbolByPath, handleSymbolSelect],
  );

  const { selectedIndex, setSelectedIndex, scrollContainerRef, handleInputKeyDown } =
    useKeyboardNavigation({
      isVisible: isQuickOpenVisible,
      allResults: isSymbolMode ? symbolResultsAsFiles : allResults,
      onClose,
      onSelect: isSymbolMode ? symbolSelectAdapter : handleItemSelect,
    });

  const handleItemHover = useCallback(
    (index: number) => {
      setSelectedIndex(index);
    },
    [setSelectedIndex],
  );

  useEffect(() => {
    if (isQuickOpenVisible) {
      setQuery("");
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
    handleInputKeyDown,
    scrollContainerRef,
    onClose,
    files,
    isLoadingFiles: useBackendFileSearch ? isFffSearching : isLoadingFiles,
    isIndexing: useBackendFileSearch ? isFffSearching : isIndexing,
    openBufferFiles,
    recentFilesInResults,
    otherFiles,
    selectedIndex,
    handleItemSelect,
    handleItemHover,
    setSelectedIndex,
    rootFolderPath: rootFolderPath || loaderRootFolder,
    isSymbolMode,
    symbols,
    isLoadingSymbols,
    handleSymbolSelect,
  };
};
