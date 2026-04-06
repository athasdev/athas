import { useEffect, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import {
  buildVisibleFileTreeRows,
  type VisibleFileTreeRow,
} from "@/features/file-explorer/lib/visible-file-tree-rows";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree-store";
import type { FileEntry } from "@/features/file-system/types/app";

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

  const visibleRows = useMemo(() => {
    return buildVisibleFileTreeRows(files, expandedPaths);
  }, [expandedPaths, files]);

  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    estimateSize: () => 22,
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
