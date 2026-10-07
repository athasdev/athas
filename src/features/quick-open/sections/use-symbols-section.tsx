import { useCallback, useMemo } from "react";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { editorAPI } from "@/features/editor/extensions/api";
import { useCenterCursor } from "@/features/editor/hooks/use-center-cursor";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useJumpListStore } from "@/features/editor/stores/jump-list.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import { calculateOffsetFromContentPosition } from "@/features/editor/utils/position";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { getBaseName } from "@/utils/path-helpers";
import { getSymbolIcon } from "../components/symbol-icon";
import { type SymbolItem, useSymbolSearch } from "../hooks/use-symbol-search";
import {
  getWorkspaceSymbolKey,
  type WorkspaceSymbolItem,
  useWorkspaceSymbolSearch,
} from "../hooks/use-workspace-symbol-search";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

function symbolItem(
  key: string,
  symbol: SymbolItem | WorkspaceSymbolItem,
  query: string,
  group: string,
  select: () => void,
  fileName?: string,
): QuickOpenItem {
  return {
    key,
    group,
    icon: getSymbolIcon(symbol.kind),
    title: <SearchMatchHighlight text={symbol.name} query={query} />,
    description: symbol.containerName,
    accessory: (
      <>
        {fileName ? <CommandItemBadge>{fileName}</CommandItemBadge> : null}
        <CommandItemBadge>{symbol.kind}</CommandItemBadge>
        <CommandItemBadge>:{symbol.line + 1}</CommandItemBadge>
      </>
    ),
    select,
  };
}

/**
 * Symbols in the active file, listed on their own when the query is empty, followed by matching
 * symbols across the project from every running language server.
 */
export function useSymbolsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const hasQuery = query.trim().length > 0;
  const fileSymbols = useSymbolSearch(`@${query}`, isActive);
  const projectSymbols = useWorkspaceSymbolSearch(`#${query}`, isActive && hasQuery);
  const { centerCursorInViewport } = useCenterCursor();

  const goToFileSymbol = useCallback(
    (symbol: SymbolItem) => {
      close();
      // The editor takes focus back as the dialog closes; move the cursor once it has.
      setTimeout(() => {
        const offset = calculateOffsetFromContentPosition(
          editorAPI.getContent(),
          symbol.line,
          symbol.character,
        );
        editorAPI.setCursorPosition({ line: symbol.line, column: symbol.character, offset });
        requestAnimationFrame(() => centerCursorInViewport(symbol.line));
      }, 50);
    },
    [centerCursorInViewport, close],
  );

  // Project symbols usually point at files that are not open, so the current position goes on
  // the jump list first, letting "go back" return here.
  const goToProjectSymbol = useCallback(
    (symbol: WorkspaceSymbolItem) => {
      close();
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
      // handleFileSelect takes 1-indexed positions; language server positions are 0-indexed.
      void handleFileSelect(
        symbol.filePath,
        false,
        symbol.line + 1,
        symbol.character + 1,
        undefined,
        false,
      );
    },
    [close, handleFileSelect],
  );

  const items = useMemo(() => {
    const inFile = fileSymbols.symbols.map((symbol) =>
      symbolItem(
        `file:${symbol.name}:${symbol.line}:${symbol.character}`,
        symbol,
        query,
        "This file",
        () => goToFileSymbol(symbol),
      ),
    );
    if (!hasQuery) return inFile;
    const inFileLocations = new Set(
      fileSymbols.symbols.map((symbol) => `${symbol.filePath}:${symbol.line}`),
    );
    const inProject = projectSymbols.symbols
      .filter((symbol) => !inFileLocations.has(`${symbol.filePath}:${symbol.line}`))
      .map((symbol) =>
        symbolItem(
          getWorkspaceSymbolKey(symbol),
          symbol,
          query,
          "Project",
          () => goToProjectSymbol(symbol),
          getBaseName(symbol.filePath, symbol.filePath),
        ),
      );
    return [...inFile, ...inProject];
  }, [
    fileSymbols.symbols,
    goToFileSymbol,
    goToProjectSymbol,
    hasQuery,
    projectSymbols.symbols,
    query,
  ]);

  const isLoading = fileSymbols.isLoading || (hasQuery && projectSymbols.isLoading);

  return {
    items,
    isLoading,
    summary: isLoading ? undefined : `${items.length} ${items.length === 1 ? "symbol" : "symbols"}`,
    empty: (
      <CommandEmpty>
        {isLoading
          ? "Loading symbols..."
          : hasQuery
            ? "No matching symbols"
            : "No symbols in this file. Type to search the project"}
      </CommandEmpty>
    ),
  };
}
