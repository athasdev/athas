import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
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
  expandedPathsOverride?: ReadonlySet<string>;
  rootFolderPath?: string;
}

export function getVisibleFileTreeRowKey(rows: readonly VisibleFileTreeRow[], index: number) {
  return rows[index]?.file.path ?? index;
}

export function useFileExplorerVisibleRows({
  files,
  expandedPathsOverride,
  rootFolderPath,
}: UseFileExplorerVisibleRowsOptions) {
  const expandedPaths = useFileTreeStore((state) => state.expandedPaths);
  const { compactFolders, hideRootFolder, sortOrder, uiFontSize } = useSettingsStore(
    useShallow((state) => ({
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
  return { rowHeight, visibleRows, visibleRowIndexByPath };
}
