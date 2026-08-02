import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useShallow } from "zustand/react/shallow";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { getFileTreeRowHeight } from "@/features/file-explorer/lib/file-tree-row";
import {
  buildVisibleFileTreeRows,
  type VisibleFileTreeRow,
} from "@/features/file-explorer/lib/visible-file-tree-rows";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import type { FileEntry } from "@/features/file-system/types/app.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";

interface UseFileExplorerVisibleRowsOptions {
  files: FileEntry[];
  activePath?: string;
  containerRef: RefObject<HTMLDivElement | null>;
  expandedPathsOverride?: ReadonlySet<string>;
  rootFolderPath?: string;
}

interface VirtualRowBounds {
  index: number;
  start: number;
  end: number;
}

interface ActivePathRevealState {
  path: string;
  index: number;
  rowHeight: number;
}

export function isVirtualRowFullyVisible({
  index,
  virtualRows,
  scrollOffset,
  viewportHeight,
}: {
  index: number;
  virtualRows: VirtualRowBounds[];
  scrollOffset: number;
  viewportHeight: number;
}) {
  const row = virtualRows.find((virtualRow) => virtualRow.index === index);
  if (!row) return false;

  const viewportEnd = scrollOffset + viewportHeight;
  return row.start >= scrollOffset && row.end <= viewportEnd;
}

export function useFileExplorerVisibleRows({
  files,
  activePath,
  containerRef,
  expandedPathsOverride,
  rootFolderPath,
}: UseFileExplorerVisibleRowsOptions) {
  const expandedPaths = useFileTreeStore((state) => state.expandedPaths);
  const { autoRevealActiveFile, compactFolders, hideRootFolder, sortOrder, uiFontSize } =
    useSettingsStore(
      useShallow((state) => ({
        autoRevealActiveFile: state.settings.autoRevealActiveFileInFileTree,
        compactFolders: state.settings.compactFoldersInFileTree,
        hideRootFolder: state.settings.hideRootFolderInFileTree,
        sortOrder: state.settings.fileTreeSortOrder,
        uiFontSize: state.settings.uiFontSize,
      })),
    );
  const rowHeight = getFileTreeRowHeight(uiFontSize);

  const visibleRows = useMemo(() => {
    return buildVisibleFileTreeRows(files, expandedPathsOverride ?? expandedPaths, {
      compactFolders,
      hiddenRootPath: hideRootFolder ? rootFolderPath : undefined,
      sortOrder,
    });
  }, [
    compactFolders,
    expandedPaths,
    expandedPathsOverride,
    files,
    hideRootFolder,
    rootFolderPath,
    sortOrder,
  ]);
  const visibleRowIndexByPath = useMemo(() => {
    const indexByPath = new Map<string, number>();
    for (let index = 0; index < visibleRows.length; index++) {
      const row = visibleRows[index];
      if (row) {
        indexByPath.set(row.file.path, index);
      }
    }
    return indexByPath;
  }, [visibleRows]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => containerRef.current,
    overscan: 8,
  });

  const revealedActivePathRef = useRef<ActivePathRevealState | null>(null);

  useLayoutEffect(() => {
    if (!autoRevealActiveFile) {
      revealedActivePathRef.current = null;
      return;
    }

    if (!activePath) {
      revealedActivePathRef.current = null;
      return;
    }

    if (fileOpenBenchmark.has(activePath)) {
      fileOpenBenchmark.mark(activePath, "visible-rows-sync");
    }

    const index = visibleRowIndexByPath.get(activePath) ?? -1;
    if (index < 0) return;

    if (fileOpenBenchmark.has(activePath)) {
      fileOpenBenchmark.mark(activePath, "visible-row-found", `index=${index}`);
    }

    const previousReveal = revealedActivePathRef.current;
    if (
      previousReveal?.path === activePath &&
      previousReveal.index === index &&
      previousReveal.rowHeight === rowHeight
    ) {
      return;
    }

    const container = containerRef.current;
    if (
      container &&
      isVirtualRowFullyVisible({
        index,
        virtualRows: rowVirtualizer.getVirtualItems(),
        scrollOffset: rowVirtualizer.scrollOffset ?? container.scrollTop,
        viewportHeight: container.clientHeight,
      })
    ) {
      revealedActivePathRef.current = { path: activePath, index, rowHeight };
      return;
    }

    rowVirtualizer.scrollToIndex(index, { align: "auto" });
    revealedActivePathRef.current = { path: activePath, index, rowHeight };
  }, [
    activePath,
    autoRevealActiveFile,
    containerRef,
    rowHeight,
    rowVirtualizer,
    visibleRowIndexByPath,
  ]);

  return { rowHeight, visibleRows, visibleRowIndexByPath, rowVirtualizer };
}

export type VisibleRow = VisibleFileTreeRow;
