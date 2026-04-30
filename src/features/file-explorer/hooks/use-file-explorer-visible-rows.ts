import { useEffect, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { FILE_TREE_DENSITY_CONFIG } from "@/features/file-explorer/lib/file-tree-density";
import {
  buildVisibleFileTreeRows,
  type VisibleFileTreeRow,
} from "@/features/file-explorer/lib/visible-file-tree-rows";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree-store";
import type { FileEntry } from "@/features/file-system/types/app";
import { useSettingsStore } from "@/features/settings/store";

interface UseFileExplorerVisibleRowsOptions {
  files: FileEntry[];
  activePath?: string;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useFileExplorerVisibleRows({
  files,
  activePath,
  containerRef,
}: UseFileExplorerVisibleRowsOptions) {
  const expandedPaths = useFileTreeStore((state) => state.expandedPaths);
  const compactFolders = useSettingsStore((state) => state.settings.compactFoldersInFileTree);
  const density = useSettingsStore((state) => state.settings.fileTreeDensity);
  const rowHeight = FILE_TREE_DENSITY_CONFIG[density].rowHeight;

  const visibleRows = useMemo(() => {
    return buildVisibleFileTreeRows(files, expandedPaths, { compactFolders });
  }, [compactFolders, expandedPaths, files]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => rowHeight,
    getScrollElement: () => containerRef.current,
    overscan: 8,
  });

  useEffect(() => {
    if (!activePath) return;
    if (fileOpenBenchmark.has(activePath)) {
      fileOpenBenchmark.mark(activePath, "visible-rows-sync");
    }
    const index = visibleRows.findIndex((row) => row.file.path === activePath);
    if (index >= 0) {
      if (fileOpenBenchmark.has(activePath)) {
        fileOpenBenchmark.mark(activePath, "visible-row-found", `index=${index}`);
      }
      rowVirtualizer.scrollToIndex(index, { align: "auto" });
    }
  }, [activePath, rowVirtualizer, visibleRows]);

  return { visibleRows, rowVirtualizer };
}

export type VisibleRow = VisibleFileTreeRow;
