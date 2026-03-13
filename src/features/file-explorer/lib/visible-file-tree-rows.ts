import type { FileEntry } from "@/features/file-system/types/app";

export interface VisibleFileTreeRow {
  file: FileEntry;
  depth: number;
  isExpanded: boolean;
}

export function buildVisibleFileTreeRows(
  files: FileEntry[],
  expandedPaths: ReadonlySet<string>,
): VisibleFileTreeRow[] {
  const rows: VisibleFileTreeRow[] = [];

  const walk = (items: FileEntry[], depth: number) => {
    for (const item of items) {
      const isExpanded = item.isDir && expandedPaths.has(item.path);
      rows.push({ file: item, depth, isExpanded });

      if (item.isDir && isExpanded && item.children) {
        walk(item.children, depth + 1);
      }
    }
  };

  walk(files, 0);
  return rows;
}
