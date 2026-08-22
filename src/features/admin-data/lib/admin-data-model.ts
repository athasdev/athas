import type { AdminDataSource, AdminDataTable } from "@/features/admin-data/types/admin-data.types";

const STORAGE_PREFIX = "athas-admin-data-sources:";

type JsonRecord = Record<string, unknown>;
type PathSegment = { type: "property"; value: string } | { type: "array"; index?: number };

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRowsPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  const normalizedPath = path.trim();

  if (!normalizedPath) return segments;

  const pattern = /([^.[\]]+)|\[(\d*)\]/g;
  let match: RegExpExecArray | null;
  let consumed = "";

  while ((match = pattern.exec(normalizedPath)) !== null) {
    const gap = normalizedPath.slice(consumed.length, match.index);
    if (gap && gap !== ".") throw new Error(`Invalid rows path near "${gap}"`);

    if (match[1]) {
      segments.push({ type: "property", value: match[1] });
    } else {
      segments.push({
        type: "array",
        index: match[2] === "" ? undefined : Number(match[2]),
      });
    }
    consumed = normalizedPath.slice(0, pattern.lastIndex);
  }

  if (consumed.length !== normalizedPath.length) {
    throw new Error(`Invalid rows path near "${normalizedPath.slice(consumed.length)}"`);
  }

  return segments;
}

function selectRowsValue(payload: unknown, path: string): unknown[] {
  let values = [payload];

  for (const segment of parseRowsPath(path)) {
    if (segment.type === "property") {
      values = values.flatMap((value) => {
        if (Array.isArray(value)) {
          return value.flatMap((item) =>
            isJsonRecord(item) && segment.value in item ? [item[segment.value]] : [],
          );
        }
        return isJsonRecord(value) && segment.value in value ? [value[segment.value]] : [];
      });
      continue;
    }

    values = values.flatMap((value) => {
      if (!Array.isArray(value)) return [];
      if (segment.index === undefined) return value;
      return segment.index < value.length ? [value[segment.index]] : [];
    });
  }

  return values;
}

function flattenRecord(record: JsonRecord, prefix = ""): JsonRecord {
  const flattened: JsonRecord = {};

  for (const [key, value] of Object.entries(record)) {
    const column = prefix ? `${prefix}.${key}` : key;
    if (isJsonRecord(value)) {
      Object.assign(flattened, flattenRecord(value, column));
    } else {
      flattened[column] = value;
    }
  }

  return flattened;
}

function normalizeCell(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

export function jsonToAdminDataTable(payload: unknown, rowsPath = ""): AdminDataTable {
  const selectedValues = selectRowsValue(payload, rowsPath);
  const records = selectedValues.flatMap((value) => (Array.isArray(value) ? value : [value]));

  if (records.length === 0) {
    throw new Error(rowsPath ? `No rows found at "${rowsPath}"` : "The response has no rows");
  }

  const flattenedRecords: JsonRecord[] = records.map((record) =>
    isJsonRecord(record) ? flattenRecord(record) : { value: record },
  );
  const columns = Array.from(new Set(flattenedRecords.flatMap((record) => Object.keys(record))));

  if (columns.length === 0) throw new Error("The response rows have no displayable fields");

  return {
    columns,
    rows: flattenedRecords.map((record) => columns.map((column) => normalizeCell(record[column]))),
  };
}

function escapeCsvCell(value: string | number | boolean | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function adminDataTableToCsv(table: AdminDataTable): string {
  return [table.columns, ...table.rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function isAdminDataSource(value: unknown): value is AdminDataSource {
  return (
    isJsonRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.url === "string" &&
    typeof value.rowsPath === "string" &&
    (value.authentication === "none" || value.authentication === "github")
  );
}

export function getAdminDataStorageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function loadAdminDataSources(
  projectPath: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): AdminDataSource[] {
  try {
    const value = JSON.parse(storage.getItem(getAdminDataStorageKey(projectPath)) ?? "[]");
    return Array.isArray(value) ? value.filter(isAdminDataSource) : [];
  } catch {
    return [];
  }
}

export function saveAdminDataSources(
  projectPath: string,
  sources: AdminDataSource[],
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(getAdminDataStorageKey(projectPath), JSON.stringify(sources));
}
