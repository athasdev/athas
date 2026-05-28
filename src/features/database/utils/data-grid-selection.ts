import { formatCellValue } from "../hooks/use-cell-copy";

export interface GridCellPosition {
  row: number;
  col: number;
}

export interface GridSelectionRange {
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface GridMoveBounds {
  rowCount: number;
  columnCount: number;
}

export interface GridSelectionFormatOptions {
  columns?: string[];
  includeHeaders?: boolean;
}

export function getGridRowCells(row: unknown[], columnCount: number): unknown[] {
  const safeColumnCount =
    Number.isFinite(columnCount) && columnCount > 0 ? Math.trunc(columnCount) : 0;
  return Array.from({ length: safeColumnCount }, (_, index) => row[index]);
}

export function normalizeGridRange(
  anchor: GridCellPosition,
  focus: GridCellPosition,
): GridSelectionRange {
  const anchorRow = normalizeGridRangeIndex(anchor.row);
  const anchorCol = normalizeGridRangeIndex(anchor.col);
  const focusRow = normalizeGridRangeIndex(focus.row);
  const focusCol = normalizeGridRangeIndex(focus.col);

  return {
    startRow: Math.min(anchorRow, focusRow),
    endRow: Math.max(anchorRow, focusRow),
    startCol: Math.min(anchorCol, focusCol),
    endCol: Math.max(anchorCol, focusCol),
  };
}

export function getFullGridRange(rowCount: number, columnCount: number): GridSelectionRange | null {
  if (
    !Number.isFinite(rowCount) ||
    !Number.isFinite(columnCount) ||
    rowCount <= 0 ||
    columnCount <= 0
  )
    return null;
  const safeRowCount = Math.trunc(rowCount);
  const safeColumnCount = Math.trunc(columnCount);
  if (safeRowCount <= 0 || safeColumnCount <= 0) return null;
  return {
    startRow: 0,
    endRow: safeRowCount - 1,
    startCol: 0,
    endCol: safeColumnCount - 1,
  };
}

export function getGridRowRange(row: number, columnCount: number): GridSelectionRange | null {
  if (!Number.isFinite(row) || !Number.isFinite(columnCount) || row < 0 || columnCount <= 0) {
    return null;
  }
  const safeRow = Math.trunc(row);
  const safeColumnCount = Math.trunc(columnCount);
  if (safeColumnCount <= 0) return null;
  return {
    startRow: safeRow,
    endRow: safeRow,
    startCol: 0,
    endCol: safeColumnCount - 1,
  };
}

function clampGridIndex(index: number, maxIndex: number) {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.trunc(index), maxIndex));
}

function normalizeGridMoveBounds(bounds: GridMoveBounds): GridMoveBounds | null {
  if (!Number.isFinite(bounds.rowCount) || !Number.isFinite(bounds.columnCount)) return null;

  const rowCount = Math.trunc(bounds.rowCount);
  const columnCount = Math.trunc(bounds.columnCount);
  if (rowCount <= 0 || columnCount <= 0) return null;

  return { rowCount, columnCount };
}

export function moveGridCell(
  current: GridCellPosition | null,
  rowDelta: number,
  colDelta: number,
  bounds: GridMoveBounds,
): GridCellPosition | null {
  const safeBounds = normalizeGridMoveBounds(bounds);
  if (!safeBounds) return null;

  if (!current) return { row: 0, col: 0 };

  const start = {
    row: clampGridIndex(current.row, safeBounds.rowCount - 1),
    col: clampGridIndex(current.col, safeBounds.columnCount - 1),
  };
  return {
    row: clampGridIndex(start.row + rowDelta, safeBounds.rowCount - 1),
    col: clampGridIndex(start.col + colDelta, safeBounds.columnCount - 1),
  };
}

export function moveGridCellByTab(
  current: GridCellPosition | null,
  direction: 1 | -1,
  bounds: GridMoveBounds,
): GridCellPosition | null {
  const safeBounds = normalizeGridMoveBounds(bounds);
  if (!safeBounds) return null;
  if (!current) return { row: 0, col: 0 };

  const start = {
    row: clampGridIndex(current.row, safeBounds.rowCount - 1),
    col: clampGridIndex(current.col, safeBounds.columnCount - 1),
  };
  const flatIndex = start.row * safeBounds.columnCount + start.col + direction;
  const maxIndex = safeBounds.rowCount * safeBounds.columnCount - 1;
  const nextIndex = clampGridIndex(flatIndex, maxIndex);

  return {
    row: Math.floor(nextIndex / safeBounds.columnCount),
    col: nextIndex % safeBounds.columnCount,
  };
}

export function isCellInRange(cell: GridCellPosition, range: GridSelectionRange | null): boolean {
  if (!range) return false;
  return (
    cell.row >= range.startRow &&
    cell.row <= range.endRow &&
    cell.col >= range.startCol &&
    cell.col <= range.endCol
  );
}

function uniqueColumnKeys(columns: string[]): string[] {
  const seen = new Map<string, number>();

  return columns.map((column, index) => {
    const normalizedColumn = column.trim();
    const baseKey = normalizedColumn || `column_${index + 1}`;
    const count = seen.get(baseKey) ?? 0;
    seen.set(baseKey, count + 1);
    return count === 0 ? baseKey : `${baseKey}_${count + 1}`;
  });
}

function normalizeGridRangeIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.trunc(index));
}

function normalizeGridSelectionRange(range: GridSelectionRange): GridSelectionRange {
  const startRow = normalizeGridRangeIndex(range.startRow);
  const endRow = normalizeGridRangeIndex(range.endRow);
  const startCol = normalizeGridRangeIndex(range.startCol);
  const endCol = normalizeGridRangeIndex(range.endCol);

  return {
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

export function formatGridSelection(
  rows: unknown[][],
  range: GridSelectionRange,
  options: GridSelectionFormatOptions = {},
): string {
  const safeRange = normalizeGridSelectionRange(range);
  const selectedColumnCount = Math.max(0, safeRange.endCol - safeRange.startCol + 1);
  const selectedRows = rows
    .slice(safeRange.startRow, safeRange.endRow + 1)
    .map((row) =>
      Array.from({ length: selectedColumnCount }, (_, index) =>
        formatCellValue(row[safeRange.startCol + index]),
      ).join("\t"),
    )
    .join("\n");

  if (!options.includeHeaders || !options.columns?.length) return selectedRows;

  const headerColumns = Array.from(
    { length: Math.max(options.columns.length, safeRange.endCol + 1) },
    (_, index) => options.columns?.[index] ?? "",
  );
  const headers = uniqueColumnKeys(headerColumns)
    .slice(safeRange.startCol, safeRange.endCol + 1)
    .join("\t");
  return selectedRows ? `${headers}\n${selectedRows}` : headers;
}
