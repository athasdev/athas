import type { ColumnInfo, DatabaseRow } from "../models/common.types";

export function coerceDatabaseValue(rawValue: string, columnType?: string): string | number | null {
  const normalizedValue = rawValue.trim();
  if (!normalizedValue) return null;

  const normalizedType = columnType?.toLowerCase() ?? "";

  if (normalizedType.includes("int")) {
    if (!/^[+-]?\d+$/.test(normalizedValue)) return rawValue;
    const parsedValue = Number(normalizedValue);
    return Number.isSafeInteger(parsedValue) ? parsedValue : rawValue;
  }

  if (normalizedType.includes("real") || normalizedType.includes("float")) {
    const parsedValue = Number(normalizedValue);
    return Number.isFinite(parsedValue) ? parsedValue : rawValue;
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

export function databaseRowToFormValues(rowData: DatabaseRow): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(rowData)) {
    values[key] = value === null || value === undefined ? "" : String(value);
  }
  return values;
}
