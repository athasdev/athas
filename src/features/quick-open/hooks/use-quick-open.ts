import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { editorAPI } from "@/features/editor/extensions/api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFffSearch } from "@/features/file-search/hooks/use-fff-search";
import {
  canUseNativeFileSearch,
  getNativeWorkspaceRootPaths,
} from "@/features/file-search/utils/file-search-paths";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useCenterCursor } from "@/features/editor/hooks/use-center-cursor";
import { calculateOffsetFromContentPosition } from "@/features/editor/utils/position";
import { getBaseName } from "@/utils/path-helpers";
import { SEARCH_DEBOUNCE_DELAY } from "../constants/limits";
import { useFileLoader } from "./use-file-loader";
import { useFileSearch } from "./use-file-search";
import { useKeyboardNavigation } from "./use-keyboard-navigation";
import { type SymbolItem, useSymbolSearch } from "./use-symbol-search";
import {
  getWorkspaceSymbolKey,
  type WorkspaceSymbolItem,
  useWorkspaceSymbolSearch,
} from "./use-workspace-symbol-search";

export const useQuickOpen = () => {
  const isQuickOpenVisible = useUIState((state) => state.isQuickOpenVisible);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const workspaceFolders = useFileSystemStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.addOrUpdateRecentFile);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const inputRef = useRef<HTMLInputElement>(null);
  const { centerCursorInViewport } = useCenterCursor();

  // Detect symbol mode (query starts with @) and workspace-symbol mode (query starts with #)
  const isSymbolMode = query.startsWith("@");
  const isWorkspaceSymbolMode = query.startsWith("#");
  const useBackendFileSearch = canUseNativeFileSearch(rootFolderPath);

  const onClose = useCallback(() => {
    setIsQuickOpenVisible(false);
  }, [setIsQuickOpenVisible]);

  const {
    files,
    isLoadingFiles,
    isIndexing,
    rootFolderPath: loaderRootFolder,
  } = useFileLoader(isQuickOpenVisible);

  const { hits: fffHits, isSearching: isFffSearching } = useFffSearch(
    debouncedQuery,
    isQuickOpenVisible && !isSymbolMode && !isWorkspaceSymbolMode,
    nativeRootPaths,
  );

  const { openBufferFiles, recentFilesInResults, otherFiles } = useFileSearch(
    files,
    isSymbolMode || isWorkspaceSymbolMode ? "" : debouncedQuery,
    isSymbolMode || isWorkspaceSymbolMode ? null : fffHits,
    {
      rootFolderPath,
      useBackendResults:
        useBackendFileSearch &&
        !isSymbolMode &&
        !isWorkspaceSymbolMode &&
        debouncedQuery.trim().length > 0,
    },
  );

  // Symbol search (only active in @ mode)
  const { symbols, isLoading: isLoadingSymbols } = useSymbolSearch(query, isSymbolMode);

  // Workspace-wide symbol search (only active in # mode)
  const { symbols: workspaceSymbols, isLoading: isLoadingWorkspaceSymbols } =
    useWorkspaceSymbolSearch(query, isWorkspaceSymbolMode);

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

  // Workspace-symbol results routinely point at files that are not open yet, so unlike
  // handleSymbolSelect (which just moves the cursor in the already-open active file), this
  // needs to push a jump-list entry for the current position and open the target file.
  const handleWorkspaceSymbolSelect = useCallback(
    (symbol: WorkspaceSymbolItem) => {
      onClose();

      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      if (activeBuffer?.type === "editor" && activeBuffer.path) {
        const editorState = useEditorStateStore.getState();
        useJumpListStore.getState().actions.pushEntry({
          bufferId: activeBuffer.id,
          filePath: activeBuffer.path,
          line: editorState.cursorPosition.line,
          column: editorState.cursorPosition.column,
          offset: editorState.cursorPosition.offset,
          scrollTop: editorState.scrollTop,
          scrollLeft: editorState.scrollLeft,
        });
      }

      // handleFileSelect expects 1-indexed line/column; LSP/FlatWorkspaceSymbol positions
      // are 0-indexed.
      void handleFileSelect(
        symbol.filePath,
        false,
        symbol.line + 1,
        symbol.character + 1,
        undefined,
        false,
      );
    },
    [onClose, handleFileSelect],
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

  // Workspace symbols need a stable identity across files and overlapping locations.
  const { workspaceSymbolResultsAsFiles, workspaceSymbolByPath } = useMemo(() => {
    const nextWorkspaceSymbolResultsAsFiles = [];
    const nextWorkspaceSymbolByPath = new Map<string, WorkspaceSymbolItem>();
    for (const symbol of workspaceSymbols) {
      const path = getWorkspaceSymbolKey(symbol);
      nextWorkspaceSymbolResultsAsFiles.push({
        name: symbol.name,
        path,
        isDir: false,
      });
      nextWorkspaceSymbolByPath.set(path, symbol);
    }

    return {
      workspaceSymbolResultsAsFiles: nextWorkspaceSymbolResultsAsFiles,
      workspaceSymbolByPath: nextWorkspaceSymbolByPath,
    };
  }, [workspaceSymbols]);

  const workspaceSymbolSelectAdapter = useCallback(
    (path: string) => {
      const symbol = workspaceSymbolByPath.get(path);
      if (symbol) handleWorkspaceSymbolSelect(symbol);
    },
    [workspaceSymbolByPath, handleWorkspaceSymbolSelect],
  );

  const { selectedIndex, setSelectedIndex, scrollContainerRef, handleInputKeyDown } =
    useKeyboardNavigation({
      isVisible: isQuickOpenVisible,
      allResults: isSymbolMode
        ? symbolResultsAsFiles
        : isWorkspaceSymbolMode
          ? workspaceSymbolResultsAsFiles
          : allResults,
      onClose,
      onSelect: isSymbolMode
        ? symbolSelectAdapter
        : isWorkspaceSymbolMode
          ? workspaceSymbolSelectAdapter
          : handleItemSelect,
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
    isLoadingFiles: isLoadingFiles || isFffSearching,
    isIndexing: isIndexing || isFffSearching,
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
    isWorkspaceSymbolMode,
    workspaceSymbols,
    isLoadingWorkspaceSymbols,
    handleWorkspaceSymbolSelect,
  };
};
