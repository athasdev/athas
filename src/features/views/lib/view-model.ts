import type { CustomViewDefinition, ViewTable } from "@/features/views/types/view.types";

const STORAGE_PREFIX = "athas-views:";
const LEGACY_STORAGE_PREFIX = "athas-admin-data-sources:";

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

export function jsonToViewTable(payload: unknown, rowsPath = ""): ViewTable {
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

export function viewTableToCsv(table: ViewTable): string {
  return [table.columns, ...table.rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function normalizeView(value: unknown): CustomViewDefinition | null {
  if (
    !isJsonRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.rowsPath !== "string"
  ) {
    return null;
  }

  if (value.kind === "github" && typeof value.endpointPath === "string") {
    return {
      id: value.id,
      name: value.name,
      rowsPath: value.rowsPath,
      kind: "github",
      endpointPath: value.endpointPath,
    };
  }

  if (
    (value.kind === "json" || value.kind === undefined) &&
    typeof value.url === "string" &&
    (value.authentication === "none" || value.authentication === "github")
  ) {
    return {
      id: value.id,
      name: value.name,
      rowsPath: value.rowsPath,
      kind: "json",
      url: value.url,
      authentication: value.authentication,
    };
  }

  return null;
}

export function getViewsStorageKey(projectPath: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(projectPath)}`;
}

function getLegacyViewsStorageKey(projectPath: string): string {
  return `${LEGACY_STORAGE_PREFIX}${encodeURIComponent(projectPath)}`;
}

export function loadViews(
  projectPath: string,
  storage: Pick<Storage, "getItem"> = localStorage,
): CustomViewDefinition[] {
  try {
    const storedViews =
      storage.getItem(getViewsStorageKey(projectPath)) ??
      storage.getItem(getLegacyViewsStorageKey(projectPath)) ??
      "[]";
    const value = JSON.parse(storedViews);
    return Array.isArray(value)
      ? value.map(normalizeView).filter((view): view is CustomViewDefinition => view !== null)
      : [];
  } catch {
    return [];
  }
}

export function saveViews(
  projectPath: string,
  views: CustomViewDefinition[],
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(getViewsStorageKey(projectPath), JSON.stringify(views));
}
