export type FileTreeDensity = "compact" | "default" | "comfortable";

export const FILE_TREE_DENSITY_OPTIONS: Array<{ value: FileTreeDensity; label: string }> = [
  { value: "compact", label: "Compact" },
  { value: "default", label: "Default" },
  { value: "comfortable", label: "Comfortable" },
];

export const DEFAULT_FILE_TREE_DENSITY: FileTreeDensity = "default";

export function isFileTreeDensity(value: string): value is FileTreeDensity {
  return FILE_TREE_DENSITY_OPTIONS.some((option) => option.value === value);
}

export function normalizeFileTreeDensity(value: string): FileTreeDensity {
  return isFileTreeDensity(value) ? value : DEFAULT_FILE_TREE_DENSITY;
}

export const FILE_TREE_DENSITY_CONFIG: Record<
  FileTreeDensity,
  {
    rowHeight: number;
    rowClassName: string;
  }
> = {
  compact: {
    rowHeight: 20,
    rowClassName: "h-5 gap-1 px-1.5 py-0.5",
  },
  default: {
    rowHeight: 24,
    rowClassName: "h-6 gap-1.5 px-1.5 py-1",
  },
  comfortable: {
    rowHeight: 28,
    rowClassName: "h-7 gap-2 px-1.5 py-1.5",
  },
};
