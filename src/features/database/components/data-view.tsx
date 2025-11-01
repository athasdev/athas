import { ArrowDown, ArrowUp, Filter } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useUIState } from "@/stores/ui-state-store";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import type { ColumnInfo, QueryResult } from "../models/common.types";

interface DataViewProps {
  queryResult: QueryResult;
  tableMeta: ColumnInfo[];
  tableName: string;
  currentPage: number;
  pageSize: number;
  sortColumn: string | null;
  sortDirection: "asc" | "desc";
  showColumnTypes: boolean;
  onColumnSort: (column: string) => void;
  onAddColumnFilter: (column: string) => void;
  getColumnIcon: (type: string, isPrimaryKey: boolean) => React.ReactNode;
  onCellEdit?: (rowIndex: number, columnName: string, newValue: any) => void;
}

export default function DataViewComponent({
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
  getColumnIcon,
  onCellEdit,
}: DataViewProps) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [editingCell, setEditingCell] = useState<{ rowIndex: number; columnName: string } | null>(
    null,
  );
  const [editValue, setEditValue] = useState<string>("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const { setSqliteRowMenu } = useUIState();
  const handleRowClick = (rowIndex: number, event: React.MouseEvent) => {
    if (event.ctrlKey || event.metaKey) {
      // Multi-select with Ctrl/Cmd
      setSelectedRows((prev) => {
        const newSet = new Set(prev);
        if (newSet.has(rowIndex)) {
          newSet.delete(rowIndex);
        } else {
          newSet.add(rowIndex);
        }
        return newSet;
      });
    } else if (event.shiftKey) {
      // Range select with Shift
      const sortedSelected = Array.from(selectedRows).sort((a, b) => a - b);
      if (sortedSelected.length > 0) {
        const start = Math.min(sortedSelected[0], rowIndex);
        const end = Math.max(sortedSelected[sortedSelected.length - 1], rowIndex);
        const newSet = new Set<number>();
        for (let i = start; i <= end; i++) {
          newSet.add(i);
        }
        setSelectedRows(newSet);
      } else {
        setSelectedRows(new Set([rowIndex]));
      }
    } else {
      // Single select
      setSelectedRows(new Set([rowIndex]));
    }
  };

  const handleRowContextMenu = (event: React.MouseEvent, rowIndex: number) => {
    event.preventDefault();
    const row = queryResult.rows[rowIndex];
    const rowData: Record<string, any> = {};
    queryResult.columns.forEach((column, i) => {
      rowData[column] = row[i];
    });

    setSqliteRowMenu({
      x: event.clientX,
      y: event.clientY,
      tableName,
      rowData,
    });
  };

  const handleCellClick = (
    event: React.MouseEvent,
    rowIndex: number,
    columnName: string,
    currentValue: any,
  ) => {
    // Don't trigger cell edit if we're selecting rows
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;

    // Don't edit if no onCellEdit handler
    if (!onCellEdit) return;

    // Don't edit primary key columns
    const columnInfo = tableMeta.find((col) => col.name === columnName);
    if (columnInfo?.primary_key) return;

    event.stopPropagation();
    setEditingCell({ rowIndex, columnName });
    setEditValue(currentValue === null ? "" : String(currentValue));
  };

  const handleCellEditSubmit = () => {
    if (!editingCell || !onCellEdit) return;

    const columnInfo = tableMeta.find((col) => col.name === editingCell.columnName);
    let convertedValue: any = editValue;

    // Convert value based on column type
    if (editValue === "") {
      convertedValue = null;
    } else if (columnInfo?.type.toLowerCase().includes("int")) {
      convertedValue = parseInt(editValue, 10);
    } else if (
      columnInfo?.type.toLowerCase().includes("real") ||
      columnInfo?.type.toLowerCase().includes("float")
    ) {
      convertedValue = parseFloat(editValue);
    }

    onCellEdit(editingCell.rowIndex, editingCell.columnName, convertedValue);
    setEditingCell(null);
  };

  const handleCellEditCancel = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const handleCellKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      handleCellEditSubmit();
    } else if (event.key === "Escape") {
      handleCellEditCancel();
    }
  };

  // Focus the edit input when editing starts
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingCell]);

  if (queryResult.rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="font-mono text-sm text-text-lighter italic">No data returned</div>
      </div>
    );
  }

  return (
    <div className="select-none">
      <table className="w-full border-collapse font-mono text-xs">
        <thead className="sticky top-0 z-10">
          <tr className="bg-secondary-bg">
            {/* Row number column */}
            <th className="w-10 border border-border bg-secondary-bg px-2 py-1.5 text-left">#</th>
            {queryResult.columns.map((column, i) => {
              const columnInfo = tableMeta.find((c) => c.name === column);
              const isSorted = sortColumn === column;
              return (
                <th
                  key={i}
                  className="group cursor-pointer whitespace-nowrap border border-border bg-secondary-bg px-2 py-1.5 text-left hover:bg-hover"
                  onClick={() => onColumnSort(column)}
                  title={`${column}${columnInfo ? ` (${columnInfo.type}${columnInfo.notnull ? ", NOT NULL" : ""}${columnInfo.primary_key ? ", PRIMARY KEY" : ""})` : ""}`}
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      {columnInfo && getColumnIcon(columnInfo.type, columnInfo.primary_key)}
                      <span className="flex items-center gap-1">
                        {column}
                        {isSorted &&
                          (sortDirection === "asc" ? (
                            <ArrowUp size={10} className="text-blue-500" />
                          ) : (
                            <ArrowDown size={10} className="text-blue-500" />
                          ))}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddColumnFilter(column);
                        }}
                        className="opacity-0 transition-opacity group-hover:opacity-100"
                        title="Add filter"
                      >
                        <Filter size={10} className="text-text-lighter hover:text-text" />
                      </button>
                    </div>
                    {showColumnTypes && columnInfo && (
                      <div className="text-text-lighter text-xs opacity-75">
                        {columnInfo.type}
                        {columnInfo.primary_key && " • PK"}
                        {columnInfo.notnull && " • NN"}
                      </div>
                    )}
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {queryResult.rows.map((row, rowIndex) => {
            const isSelected = selectedRows.has(rowIndex);
            return (
              <tr
                key={rowIndex}
                className={cn(
                  "cursor-pointer transition-colors",
                  isSelected ? "bg-blue-500/20 hover:bg-blue-500/30" : "hover:bg-hover",
                )}
                onClick={(e) => handleRowClick(rowIndex, e)}
                onContextMenu={(e) => handleRowContextMenu(e, rowIndex)}
              >
                {/* Row number */}
                <td className="border border-border px-2 py-1 text-text-lighter">
                  {(currentPage - 1) * pageSize + rowIndex + 1}
                </td>
                {row.map((cell, cellIndex) => {
                  const columnName = queryResult.columns[cellIndex];
                  const columnInfo = tableMeta.find((c) => c.name === columnName);
                  const isEditing =
                    editingCell?.rowIndex === rowIndex && editingCell?.columnName === columnName;
                  const isPrimaryKey = columnInfo?.primary_key;
                  const canEdit = onCellEdit && !isPrimaryKey;

                  return (
                    <td
                      key={cellIndex}
                      className={cn(
                        "max-w-[300px] border border-border px-2 py-1",
                        canEdit && !isEditing && "cursor-pointer hover:bg-hover/50",
                        isPrimaryKey && "bg-amber-50/20",
                      )}
                      title={
                        isPrimaryKey
                          ? `${columnName} (Primary Key)`
                          : canEdit
                            ? `${columnName} - Click to edit`
                            : cell === null
                              ? "NULL"
                              : String(cell)
                      }
                      onClick={(e) => handleCellClick(e, rowIndex, columnName, cell)}
                    >
                      {isEditing ? (
                        <Input
                          // @ts-ignore - Input component ref typing issue
                          ref={editInputRef}
                          type={
                            columnInfo?.type.toLowerCase().includes("int") ||
                            columnInfo?.type.toLowerCase().includes("real")
                              ? "number"
                              : "text"
                          }
                          value={editValue}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                            setEditValue(e.target.value)
                          }
                          onKeyDown={handleCellKeyDown}
                          onBlur={handleCellEditSubmit}
                          className="w-full min-w-0 border-none bg-transparent p-0 text-xs focus:ring-0"
                          placeholder={
                            columnInfo?.notnull ? "Required" : "Optional (empty for NULL)"
                          }
                        />
                      ) : cell === null ? (
                        <span className="text-text-lighter italic">NULL</span>
                      ) : typeof cell === "object" ? (
                        <span className="block truncate text-blue-500">{JSON.stringify(cell)}</span>
                      ) : (
                        <span
                          className={cn(
                            "block truncate",
                            isPrimaryKey && "font-semibold text-amber-600",
                          )}
                        >
                          {String(cell)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
