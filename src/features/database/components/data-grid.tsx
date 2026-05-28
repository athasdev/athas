import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Copy,
  FileText,
  Funnel as Filter,
  Hash,
  Key,
  Link,
  Plus,
  TextT as Type,
} from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { useCellCopy } from "../hooks/use-cell-copy";
import { mapForeignKeysByColumn } from "../lib/database-schema";
import type { ColumnInfo, ForeignKeyInfo } from "../models/common.types";
import {
  formatGridSelection,
  getFullGridRange,
  getGridRowCells,
  getGridRowRange,
  isCellInRange,
  moveGridCellByTab,
  moveGridCell,
  normalizeGridRange,
  type GridCellPosition,
} from "../utils/data-grid-selection";
import { coerceDatabaseValue } from "../utils/value-coercion";
import { writeDatabaseClipboardText } from "../utils/clipboard";
import CellRenderer from "./cell-renderer";

const MIN_COLUMN_WIDTH = 60;
const DEFAULT_COLUMN_WIDTH = 150;
const ESTIMATED_ROW_HEIGHT = 34;

const COLUMN_ICONS: Record<string, { icon: typeof Hash; color: string }> = {
  int: { icon: Hash, color: "text-accent" },
  num: { icon: Hash, color: "text-accent" },
  text: { icon: Type, color: "text-text-lighter" },
  varchar: { icon: Type, color: "text-text-lighter" },
  char: { icon: Type, color: "text-text-lighter" },
  date: { icon: Calendar, color: "text-accent" },
  time: { icon: Calendar, color: "text-accent" },
  blob: { icon: FileText, color: "text-text-lighter" },
  binary: { icon: FileText, color: "text-text-lighter" },
};

function getColumnIcon(type: string, isPrimaryKey: boolean, isForeignKey: boolean) {
  if (isPrimaryKey) return <Key className="text-text-lighter" />;
  if (isForeignKey) return <Link className="text-accent" />;
  const lowerType = type.toLowerCase();
  for (const [key, { icon: Icon, color }] of Object.entries(COLUMN_ICONS)) {
    if (lowerType.includes(key)) return <Icon className={color} />;
  }
  return <Type className="text-text-lighter" />;
}

interface DataGridProps {
  queryResult: { columns: string[]; rows: unknown[][] };
  tableMeta: ColumnInfo[];
  tableName: string | null;
  currentPage: number;
  pageSize: number;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  showColumnTypes: boolean;
  onColumnSort: (column: string) => void;
  onAddColumnFilter: (column: string) => void;
  onRowContextMenu: (e: React.MouseEvent, rowIndex: number) => void;
  onCellEdit: (rowIndex: number, columnName: string, newValue: unknown) => void;
  onCreateRow: () => void;
  canSortColumns?: boolean;
  canFilterColumns?: boolean;
  canEditCells?: boolean;
  canCreateRows?: boolean;
  canOpenRowMenu?: boolean;
  resultLabel?: string;
  foreignKeys?: ForeignKeyInfo[];
  columnWidths?: Record<string, Record<string, number>>;
  onColumnWidthChange?: (table: string, column: string, width: number) => void;
  onNavigateToForeignKey?: (toTable: string, toColumn: string, value: unknown) => void;
}

export default function DataGrid({
  queryResult,
  tableMeta,
  tableName,
  currentPage,
  pageSize,
  sortColumn,
  sortDirection,
  showColumnTypes,
  onColumnSort,
  onAddColumnFilter,
  onRowContextMenu,
  onCellEdit,
  onCreateRow,
  canSortColumns = true,
  canFilterColumns = true,
  canEditCells = true,
  canCreateRows = true,
  canOpenRowMenu = true,
  resultLabel = "rows",
  foreignKeys = [],
  columnWidths = {},
  onColumnWidthChange,
  onNavigateToForeignKey,
}: DataGridProps) {
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [activeCell, setActiveCell] = useState<GridCellPosition | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<GridCellPosition | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{
    column: string;
    startX: number;
    startWidth: number;
  } | null>(null);
  const { cellMenu, handleCellContextMenu, copyValue, copyValueWithHeaders, closeCellMenu } =
    useCellCopy();
  const rowVirtualizer = useVirtualizer({
    count: queryResult.rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    measureElement:
      typeof window !== "undefined" && !navigator.userAgent.includes("Firefox")
        ? (element) => element?.getBoundingClientRect().height
        : undefined,
    overscan: 12,
  });

  const foreignKeyMap = useMemo(() => {
    return mapForeignKeysByColumn(foreignKeys);
  }, [foreignKeys]);

  const getForeignKey = useCallback((column: string) => foreignKeyMap.get(column), [foreignKeyMap]);

  const getColumnWidth = useCallback(
    (column: string): number => {
      if (!tableName) return DEFAULT_COLUMN_WIDTH;
      return columnWidths[tableName]?.[column] ?? DEFAULT_COLUMN_WIDTH;
    },
    [columnWidths, tableName],
  );

  const handleResizeStart = useCallback(
    (event: React.PointerEvent, column: string) => {
      event.preventDefault();
      event.stopPropagation();

      resizeRef.current = {
        column,
        startX: event.clientX,
        startWidth: getColumnWidth(column),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [getColumnWidth],
  );

  const handleResizeMove = useCallback(
    (event: React.PointerEvent) => {
      if (!resizeRef.current || !tableName || !onColumnWidthChange) return;

      const { column, startX, startWidth } = resizeRef.current;
      const delta = event.clientX - startX;
      onColumnWidthChange(tableName, column, Math.max(MIN_COLUMN_WIDTH, startWidth + delta));
    },
    [onColumnWidthChange, tableName],
  );

  const handleResizeEnd = useCallback(() => {
    resizeRef.current = null;
  }, []);

  const navigateToReference = useCallback(
    (columnName: string, value: unknown) => {
      const fk = foreignKeyMap.get(columnName);
      if (!fk || value === null || value === undefined) return;
      onNavigateToForeignKey?.(fk.to_table, fk.to_column, value);
    },
    [foreignKeyMap, onNavigateToForeignKey],
  );

  const activateCell = useCallback(
    (row: number, col: number, extendSelection = false) => {
      const nextCell = { row, col };
      setActiveCell(nextCell);
      setSelectionAnchor((anchor) =>
        extendSelection ? (anchor ?? activeCell ?? nextCell) : nextCell,
      );
      rowVirtualizer.scrollToIndex(row, { align: "auto" });
    },
    [activeCell, rowVirtualizer],
  );

  const moveActiveCell = useCallback(
    (rowDelta: number, colDelta: number, extendSelection = false) => {
      const nextCell = moveGridCell(activeCell, rowDelta, colDelta, {
        rowCount: queryResult.rows.length,
        columnCount: queryResult.columns.length,
      });
      if (!nextCell) return;
      activateCell(nextCell.row, nextCell.col, extendSelection);
    },
    [activateCell, activeCell, queryResult.columns.length, queryResult.rows.length],
  );

  const moveActiveCellByTab = useCallback(
    (direction: 1 | -1) => {
      const nextCell = moveGridCellByTab(activeCell, direction, {
        rowCount: queryResult.rows.length,
        columnCount: queryResult.columns.length,
      });
      if (!nextCell) return;
      activateCell(nextCell.row, nextCell.col);
    },
    [activateCell, activeCell, queryResult.columns.length, queryResult.rows.length],
  );

  const startCellEdit = (row: number, col: string, value: unknown) => {
    if (!canEditCells) return;
    const info = tableMeta.find((c) => c.name === col);
    if (info?.primary_key) return;
    setEditing({ row, col });
    setEditValue(value === null ? "" : String(value));
  };

  const handleRowHeaderClick = (row: number, extendSelection: boolean) => {
    const rowRange = getGridRowRange(row, queryResult.columns.length);
    if (!rowRange) return;

    scrollContainerRef.current?.focus({ preventScroll: true });
    setSelectionAnchor((anchor) =>
      extendSelection && anchor ? { row: anchor.row, col: rowRange.startCol } : { row, col: 0 },
    );
    setActiveCell({ row, col: rowRange.endCol });
  };

  const handleSelectAllClick = () => {
    const fullRange = getFullGridRange(queryResult.rows.length, queryResult.columns.length);
    if (!fullRange) return;

    scrollContainerRef.current?.focus({ preventScroll: true });
    setSelectionAnchor({ row: fullRange.startRow, col: fullRange.startCol });
    setActiveCell({ row: fullRange.endRow, col: fullRange.endCol });
    rowVirtualizer.scrollToIndex(fullRange.endRow, { align: "auto" });
  };

  const handleSubmit = () => {
    if (!editing) return;
    const info = tableMeta.find((c) => c.name === editing.col);
    const value = coerceDatabaseValue(editValue, info?.type);
    onCellEdit(editing.row, editing.col, value);
    setEditing(null);
  };

  const handleGridKeyDown = async (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      if (!activeCell) return;
      event.preventDefault();
      const selectedRange = selectionAnchor
        ? normalizeGridRange(selectionAnchor, activeCell)
        : normalizeGridRange(activeCell, activeCell);
      await writeDatabaseClipboardText(
        formatGridSelection(queryResult.rows, selectedRange, {
          columns: queryResult.columns,
          includeHeaders: event.shiftKey,
        }),
      );
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      const fullRange = getFullGridRange(queryResult.rows.length, queryResult.columns.length);
      if (!fullRange) return;
      event.preventDefault();
      setSelectionAnchor({ row: fullRange.startRow, col: fullRange.startCol });
      setActiveCell({ row: fullRange.endRow, col: fullRange.endCol });
      rowVirtualizer.scrollToIndex(fullRange.endRow, { align: "auto" });
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(null);
      setActiveCell(null);
      setSelectionAnchor(null);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveCell(1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveCell(-1, 0, event.shiftKey);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveActiveCell(0, 1, event.shiftKey);
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveActiveCell(0, -1, event.shiftKey);
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      moveActiveCell(10, 0, event.shiftKey);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      moveActiveCell(-10, 0, event.shiftKey);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveActiveCellByTab(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      activateCell(event.metaKey || event.ctrlKey ? 0 : (activeCell?.row ?? 0), 0, event.shiftKey);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      activateCell(
        event.metaKey || event.ctrlKey ? queryResult.rows.length - 1 : (activeCell?.row ?? 0),
        queryResult.columns.length - 1,
        event.shiftKey,
      );
      return;
    }
    if (event.key === "Enter" && activeCell) {
      const columnName = queryResult.columns[activeCell.col];
      const value = queryResult.rows[activeCell.row]?.[activeCell.col];
      const columnInfo = tableMeta.find((c) => c.name === columnName);
      const fk = getForeignKey(columnName);
      if (canEditCells && !columnInfo?.primary_key && !fk) {
        event.preventDefault();
        startCellEdit(activeCell.row, columnName, value);
      }
    }
  };

  const cellMenuItems: ContextMenuItem[] = [
    {
      id: "copy-value",
      label: cellMenu?.copyText ? "Copy selection" : "Copy value",
      icon: <Copy />,
      onClick: copyValue,
    },
    ...(cellMenu?.copyTextWithHeaders
      ? [
          {
            id: "copy-selection-with-headers",
            label: "Copy selection with headers",
            icon: <Copy />,
            onClick: copyValueWithHeaders,
          },
        ]
      : []),
  ];
  const virtualRows = rowVirtualizer.getVirtualItems();
  const selectedRange =
    activeCell && selectionAnchor ? normalizeGridRange(selectionAnchor, activeCell) : null;
  const virtualPaddingTop = virtualRows[0]?.start ?? 0;
  const virtualPaddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end
      : 0;
  const tableColumnSpan = queryResult.columns.length + 1;

  if (queryResult.rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="ui-font ui-text-sm text-text-lighter">No data</span>
      </div>
    );
  }

  return (
    <div className="ui-font flex min-h-0 flex-1 flex-col">
      <div className="group flex h-9 items-center justify-between border-border/70 border-b px-3">
        <span className="ui-text-sm text-text-lighter">
          {queryResult.rows.length} {resultLabel}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={onCreateRow}
          className={cn(
            "rounded-md",
            canCreateRows ? "opacity-0 group-hover:opacity-100" : "cursor-default opacity-30",
          )}
          aria-label="Add row"
          disabled={!canCreateRows}
          compact
        >
          <Plus className="text-text-lighter hover:text-text" />
        </Button>
      </div>
      <div
        ref={scrollContainerRef}
        className="custom-scrollbar flex-1 overflow-auto outline-none"
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        aria-label="Database rows"
      >
        <table className="w-full border-separate border-spacing-0 ui-text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th
                className="w-10 cursor-pointer border-border/70 border-b bg-secondary-bg px-2 py-1.5 text-left font-normal text-text-lighter hover:bg-hover"
                onClick={handleSelectAllClick}
                aria-label="Select all visible cells"
              >
                #
              </th>
              {queryResult.columns.map((col, i) => {
                const info = tableMeta.find((c) => c.name === col);
                const sorted = sortColumn === col;
                const fk = getForeignKey(col);
                const colWidth = getColumnWidth(col);

                return (
                  <th
                    key={i}
                    className="group relative cursor-pointer whitespace-nowrap border-border/70 border-b bg-secondary-bg px-2 py-1.5 text-left font-normal transition-colors hover:bg-hover"
                    style={{ width: colWidth, minWidth: 60 }}
                    onClick={() => canSortColumns && onColumnSort(col)}
                  >
                    <div className="flex flex-col gap-0.5 font-normal">
                      <div className="flex items-center gap-1.5">
                        {info && getColumnIcon(info.type, info.primary_key, foreignKeyMap.has(col))}
                        <span className="flex min-w-0 items-center gap-1 text-text">
                          {col}
                          {sorted &&
                            (sortDirection === "asc" ? (
                              <ArrowUp className="text-accent" />
                            ) : (
                              <ArrowDown className="text-accent" />
                            ))}
                        </span>
                        {fk && (
                          <span
                            className="ui-text-xs text-text-lighter"
                            title={`FK: ${fk.to_table}.${fk.to_column}`}
                          >
                            FK
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canFilterColumns) onAddColumnFilter(col);
                          }}
                          className={cn(
                            "opacity-0 group-hover:opacity-100",
                            !canFilterColumns && "pointer-events-none opacity-20",
                          )}
                          aria-label={`Filter by ${col}`}
                        >
                          <Filter className="text-text-lighter hover:text-text" />
                        </Button>
                      </div>
                      {showColumnTypes && info && (
                        <div className="ui-text-xs text-text-lighter">
                          {info.type}
                          {info.primary_key && " PK"}
                          {info.notnull && " NN"}
                        </div>
                      )}
                    </div>
                    {/* Resize handle */}
                    <div
                      className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/40"
                      onPointerDown={(e) => handleResizeStart(e, col)}
                      onPointerMove={handleResizeMove}
                      onPointerUp={handleResizeEnd}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {virtualPaddingTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={tableColumnSpan} style={{ height: virtualPaddingTop, padding: 0 }} />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const ri = virtualRow.index;
              const row = queryResult.rows[ri];
              const cells = getGridRowCells(row, queryResult.columns.length);

              return (
                <tr
                  key={ri}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="cursor-pointer transition-colors hover:bg-hover/25"
                  onContextMenu={(e) => canOpenRowMenu && onRowContextMenu(e, ri)}
                >
                  <td
                    className="border-border/40 border-b px-2 py-1.5 text-text-lighter hover:bg-hover"
                    onClick={(event) => handleRowHeaderClick(ri, event.shiftKey)}
                  >
                    {(currentPage - 1) * pageSize + ri + 1}
                  </td>
                  {cells.map((cell, ci) => {
                    const col = queryResult.columns[ci];
                    const info = tableMeta.find((c) => c.name === col);
                    const isEditing = editing?.row === ri && editing?.col === col;
                    const isActive = activeCell?.row === ri && activeCell.col === ci;
                    const isSelected = isCellInRange({ row: ri, col: ci }, selectedRange);
                    const isPK = info?.primary_key ?? false;
                    const fk = getForeignKey(col);
                    const copyText =
                      isSelected && selectedRange
                        ? formatGridSelection(queryResult.rows, selectedRange)
                        : undefined;
                    const copyTextWithHeaders =
                      isSelected && selectedRange
                        ? formatGridSelection(queryResult.rows, selectedRange, {
                            columns: queryResult.columns,
                            includeHeaders: true,
                          })
                        : undefined;

                    return (
                      <td
                        key={ci}
                        className={cn(
                          "max-w-[300px] border-border/50 border-b px-2 py-1.5 font-normal text-text",
                          canEditCells && !isPK && "cursor-pointer hover:bg-hover",
                          isPK && "bg-hover/55",
                          isSelected && "bg-accent/10",
                          isActive && "outline outline-1 outline-accent/70 outline-offset-[-1px]",
                        )}
                        style={{ width: getColumnWidth(col), minWidth: 60 }}
                        onClick={(event) => {
                          scrollContainerRef.current?.focus({ preventScroll: true });
                          activateCell(ri, ci, event.shiftKey);
                        }}
                        onDoubleClick={(event) => {
                          const target = event.target;
                          if (
                            target instanceof HTMLElement &&
                            target.closest("button,a,input,textarea")
                          ) {
                            return;
                          }
                          if (canEditCells && !isPK && !fk) {
                            startCellEdit(ri, col, cell);
                          }
                        }}
                      >
                        {isEditing ? (
                          <Input
                            ref={(el) => el?.focus()}
                            type={info?.type.toLowerCase().includes("int") ? "number" : "text"}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSubmit();
                              if (e.key === "Escape") setEditing(null);
                            }}
                            onBlur={handleSubmit}
                            className="w-full rounded-lg border-border/70 bg-secondary-bg/80 ui-text-xs focus:border-accent/60"
                          />
                        ) : (
                          <CellRenderer
                            value={cell}
                            columnName={col}
                            isPrimaryKey={isPK}
                            foreignKey={fk}
                            onFkClick={navigateToReference}
                            onContextMenu={(event, value, columnName) =>
                              handleCellContextMenu(
                                event,
                                value,
                                columnName,
                                copyText,
                                copyTextWithHeaders,
                              )
                            }
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {virtualPaddingBottom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={tableColumnSpan}
                  style={{ height: virtualPaddingBottom, padding: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ContextMenu
        isOpen={!!cellMenu}
        position={cellMenu?.position ?? { x: 0, y: 0 }}
        items={cellMenuItems}
        onClose={closeCellMenu}
      />
    </div>
  );
}
