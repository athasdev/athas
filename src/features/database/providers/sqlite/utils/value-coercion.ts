import type { ColumnInfo } from "../../../models/common.types";

export function coerceDatabaseValue(rawValue: string, columnType?: string): string | number | null {
  if (!rawValue) return null;

  const normalizedType = columnType?.toLowerCase() ?? "";

  if (normalizedType.includes("int")) {
    return parseInt(rawValue, 10);
  }

  if (normalizedType.includes("real") || normalizedType.includes("float")) {
    return parseFloat(rawValue);
  }

  return rawValue;
}

export function buildDatabaseRowValues(
  values: Record<string, string>,
  columns: ColumnInfo[],
): Record<string, string | number | null> {
  const convertedValues: Record<string, string | number | null> = {};

  for (const [key, value] of Object.entries(values)) {
    const column = columns.find((col) => col.name === key);
    convertedValues[key] = coerceDatabaseValue(value, column?.type);
  }

  return convertedValues;
}
