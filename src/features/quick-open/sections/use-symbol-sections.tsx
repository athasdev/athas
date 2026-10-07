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
  select: () => void,
  fileName?: string,
): QuickOpenItem {
  return {
    key,
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

function symbolSummary(isLoading: boolean, count: number) {
  return isLoading ? undefined : `${count} ${count === 1 ? "symbol" : "symbols"}`;
}

/** Symbols in the active file, from its language server. */
export function useSymbolsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const { symbols, isLoading } = useSymbolSearch(`@${query}`, isActive);
  const { centerCursorInViewport } = useCenterCursor();

  const goToSymbol = useCallback(
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

  const items = useMemo(
    () =>
      symbols.map((symbol) =>
        symbolItem(`${symbol.name}:${symbol.line}:${symbol.character}`, symbol, query, () =>
          goToSymbol(symbol),
        ),
      ),
    [goToSymbol, query, symbols],
  );

  return {
    items,
    isLoading,
    summary: symbolSummary(isLoading, items.length),
    empty: (
      <CommandEmpty>
        {isLoading
          ? "Loading symbols..."
          : query
            ? "No matching symbols"
            : "No symbols in this file, or its language server is not running"}
      </CommandEmpty>
    ),
  };
}

/** Symbols across the project, from every running language server. */
export function useWorkspaceSymbolsSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const handleFileSelect = useFileSystemStore((state) => state.handleFileSelect);
  const { symbols, isLoading } = useWorkspaceSymbolSearch(`#${query}`, isActive);

  // These usually point at files that are not open, so the current position goes on the jump
  // list first, letting "go back" return here.
  const goToSymbol = useCallback(
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

  const items = useMemo(
    () =>
      symbols.map((symbol) =>
        symbolItem(
          getWorkspaceSymbolKey(symbol),
          symbol,
          query,
          () => goToSymbol(symbol),
          getBaseName(symbol.filePath, symbol.filePath),
        ),
      ),
    [goToSymbol, query, symbols],
  );

  return {
    items,
    isLoading,
    summary: query ? symbolSummary(isLoading, items.length) : undefined,
    empty: (
      <CommandEmpty>
        {!query.trim()
          ? "Type to search symbols across the project"
          : isLoading
            ? "Searching symbols..."
            : "No matching symbols"}
      </CommandEmpty>
    ),
  };
}
