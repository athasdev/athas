import type { ColumnInfo, ForeignKeyInfo } from "../models/common.types";

export function getColumnConstraintLabels(column: ColumnInfo): string[] {
  const labels: string[] = [];
  if (column.primary_key) labels.push("PK");
  if (column.notnull) labels.push("NN");
  if (column.default_value !== null) labels.push(`def: ${column.default_value}`);
  return labels;
}

export function formatForeignKeyLabel(foreignKey: ForeignKeyInfo): string {
  const normalizedForeignKey = normalizeForeignKeyInfo(foreignKey);
  if (!normalizedForeignKey) return "FK unknown";
  return `FK ${normalizedForeignKey.to_table}.${normalizedForeignKey.to_column}`;
}

export function mapForeignKeysByColumn(foreignKeys: ForeignKeyInfo[]): Map<string, ForeignKeyInfo> {
  const map = new Map<string, ForeignKeyInfo>();

  for (const foreignKey of foreignKeys) {
    const normalizedForeignKey = normalizeForeignKeyInfo(foreignKey);
    if (!normalizedForeignKey || map.has(normalizedForeignKey.from_column)) continue;
    map.set(normalizedForeignKey.from_column, normalizedForeignKey);
  }

  return map;
}

function normalizeForeignKeyInfo(foreignKey: ForeignKeyInfo): ForeignKeyInfo | null {
  const fromColumn = foreignKey.from_column.trim();
  const toTable = foreignKey.to_table.trim();
  const toColumn = foreignKey.to_column.trim();

  if (!fromColumn || !toTable || !toColumn) return null;

  return {
    from_column: fromColumn,
    to_table: toTable,
    to_column: toColumn,
  };
}
