import type {
  CustomViewDefinition,
  ViewPresentation,
  ViewTable,
} from "@/features/views/types/view.types";

export type ViewCell = ViewTable["rows"][number][number];

export interface ViewDisplayRow {
  index: number;
  cells: ViewTable["rows"][number];
}

export interface ViewRowGroup {
  key: string;
  label: string;
  rows: ViewDisplayRow[];
}

const TITLE_COLUMN_CANDIDATES = [
  "title",
  "name",
  "tag_name",
  "workflow.name",
  "login",
  "number",
  "id",
];
const DESCRIPTION_COLUMN_CANDIDATES = [
  "description",
  "body",
  "message",
  "display_title",
  "html_url",
];
const GROUP_COLUMN_CANDIDATES = ["status", "state", "conclusion", "type", "kind"];

function findColumn(columns: string[], candidates: string[]): string | undefined {
  const normalized = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const column = normalized.get(candidate);
    if (column) return column;
  }
  return undefined;
}

function getValidColumn(columns: string[], value: string | undefined): string | undefined {
  return value && columns.includes(value) ? value : undefined;
}

export function resolveViewPresentation(
  view: CustomViewDefinition,
  table: ViewTable,
): Required<Pick<ViewPresentation, "layout">> & Omit<ViewPresentation, "layout"> {
  const presentation = view.presentation;
  const titleColumn =
    getValidColumn(table.columns, presentation?.titleColumn) ??
    findColumn(table.columns, TITLE_COLUMN_CANDIDATES) ??
    table.columns[0];
  const descriptionColumn =
    getValidColumn(table.columns, presentation?.descriptionColumn) ??
    findColumn(
      table.columns.filter((column) => column !== titleColumn),
      DESCRIPTION_COLUMN_CANDIDATES,
    );
  const groupBy =
    presentation?.groupBy === null
      ? undefined
      : (getValidColumn(table.columns, presentation?.groupBy) ??
        (presentation?.layout === "board"
          ? findColumn(table.columns, GROUP_COLUMN_CANDIDATES)
          : undefined));

  return {
    layout: presentation?.layout ?? "table",
    ...(titleColumn ? { titleColumn } : {}),
    ...(descriptionColumn ? { descriptionColumn } : {}),
    ...(groupBy ? { groupBy } : {}),
  };
}

export function getViewCell(
  table: ViewTable,
  row: ViewTable["rows"][number],
  column: string | undefined,
): ViewCell {
  if (!column) return null;
  const index = table.columns.indexOf(column);
  return index === -1 ? null : (row[index] ?? null);
}

export function formatViewCell(value: ViewCell): string {
  if (value === null) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function humanizeViewColumn(column: string): string {
  const segments = column.split(".");
  const segment = segments[segments.length - 1] ?? column;
  return segment.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function groupViewRows(table: ViewTable, groupBy?: string): ViewRowGroup[] {
  const rows = table.rows.map((cells, index) => ({ index, cells }));
  if (!groupBy) {
    return [{ key: "all", label: "All items", rows }];
  }

  const groups = new Map<string, ViewDisplayRow[]>();
  for (const row of rows) {
    const label = formatViewCell(getViewCell(table, row.cells, groupBy));
    const groupRows = groups.get(label) ?? [];
    groupRows.push(row);
    groups.set(label, groupRows);
  }

  return Array.from(groups, ([label, groupRows]) => ({
    key: label,
    label,
    rows: groupRows,
  }));
}
