export interface CreateTableColumnDraft {
  name: string;
  type: string;
  notnull: boolean;
}

export function getInitialCreateTableColumn(): CreateTableColumnDraft {
  return { name: "", type: "TEXT", notnull: false };
}

export function normalizeCreateTableColumns(
  columns: CreateTableColumnDraft[],
): CreateTableColumnDraft[] {
  const seen = new Set<string>();

  return columns
    .map((column) => ({
      ...column,
      name: column.name.trim(),
      type: column.type.trim() || "TEXT",
    }))
    .filter((column) => {
      if (column.name.length === 0) return false;
      const normalizedName = column.name.toLowerCase();
      if (seen.has(normalizedName)) return false;
      seen.add(normalizedName);
      return true;
    });
}
