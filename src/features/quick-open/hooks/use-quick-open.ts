import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebounce } from "use-debounce";
import { editorAPI } from "@/features/editor/services/editor-api";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useRecentFilesStore } from "@/features/file-system/stores/recent-files.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useFffSearch } from "@/features/file-search/hooks/use-fff-search";
import {
  canUseNativeFileSearch,
  getNativeWorkspaceRootPaths,
} from "@/features/file-search/services/file-search-paths";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { calculateOffsetFromContentPosition } from "@/features/editor/services/position";
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
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { getActiveBufferId } from "@/features/panes/stores/pane-selectors";

export const useQuickOpen = () => {
  const isQuickOpenVisible = useUIState((state) => state.isQuickOpenVisible);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const workspaceFolders = useProjectStore((state) => state.workspaceFolders);
  const nativeRootPaths = useMemo(
    () => getNativeWorkspaceRootPaths(rootFolderPath, workspaceFolders),
    [rootFolderPath, workspaceFolders],
  );
  const addOrUpdateRecentFile = useRecentFilesStore((state) => state.actions.addOrUpdateRecentFile);
  const [query, setQuery] = useState("");
  const [debouncedQuery] = useDebounce(query, SEARCH_DEBOUNCE_DELAY);
  const inputRef = useRef<HTMLInputElement>(null);

  // Detect symbol mode (query starts with @) and workspace-symbol mode (query starts with #)
  const isSymbolMode = query.startsWith("@");
  const isWorkspaceSymbolMode = query.startsWith("#");
  const useBackendFileSearch = canUseNativeFileSearch(rootFolderPath);

  const onClose = useCallback(() => {
    setIsQuickOpenVisible(false);
  }, [setIsQuickOpenVisible]);

  const {
    files,
    hasLoadedFiles,
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
      hasLoadedFiles,
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

      // Waits for the palette to close, so the editor takes focus after it.
      setTimeout(() => {
        const bufferId = getActiveBufferId();
        if (!bufferId) return;
        const position = {
          line: symbol.line,
          column: symbol.character,
          offset: calculateOffsetFromContentPosition(
            editorAPI.getContent(),
            symbol.line,
            symbol.character,
          ),
        };
        // The same path as go-to-definition: moves the cursor, centers it and focuses the editor.
        useEditorStateStore.getState().actions.requestNavigation({
          bufferId,
          range: { start: position, end: position },
        });
      }, 50);
    },
    [onClose],
  );

  // Workspace-symbol results routinely point at files that are not open yet, so unlike
  // handleSymbolSelect (which just moves the cursor in the already-open active file), this
  // needs to push a jump-list entry for the current position and open the target file.
  const handleWorkspaceSymbolSelect = useCallback(
    (symbol: WorkspaceSymbolItem) => {
      onClose();

      const activeBuffer = useBufferStore.getState().actions.getActiveBuffer();
      if (activeBuffer?.type === "editor" && activeBuffer.path) {
        const editorState = useEditorStateStore.getState();
        useJumpListStore.getState().actions.pushEntry({
          bufferId: activeBuffer.id,
          filePath: activeBuffer.path,
          line: editorState.cursorPosition.line,
          column: editorState.cursorPosition.column,
          offset: editorState.cursorPosition.offset,
          ...editorState.actions.getScroll(),
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
