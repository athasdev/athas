import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Copy,
  FileText,
  Filter,
  Hash,
  Key,
  Link,
  Plus,
  Type,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/button";
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import Input from "@/ui/input";
import { cn } from "@/utils/cn";
import { useCellCopy } from "../hooks/use-cell-copy";
import { useColumnResize } from "../hooks/use-column-resize";
import { useFkNavigation } from "../hooks/use-fk-navigation";
import type { ColumnInfo } from "../sqlite-types";
import CellRenderer from "./cell-renderer";

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
}: DataGridProps) {
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const { getColumnWidth, handleResizeStart, handleResizeMove, handleResizeEnd } =
    useColumnResize(tableName);
  const { cellMenu, handleCellContextMenu, copyValue, closeCellMenu } = useCellCopy();
  const { getForeignKey, isForeignKey, navigateToReference } = useFkNavigation();

  const handleCellClick = (row: number, col: string, value: unknown) => {
    if (!canEditCells) return;
    const info = tableMeta.find((c) => c.name === col);
    if (info?.primary_key) return;
    setEditing({ row, col });
    setEditValue(value === null ? "" : String(value));
  };

  const handleSubmit = () => {
    if (!editing) return;
    const info = tableMeta.find((c) => c.name === editing.col);
    let value: unknown = editValue;
    if (editValue === "") value = null;
    else if (info?.type.toLowerCase().includes("int")) value = parseInt(editValue, 10);
    else if (
      info?.type.toLowerCase().includes("real") ||
      info?.type.toLowerCase().includes("float")
    )
      value = parseFloat(editValue);
    onCellEdit(editing.row, editing.col, value);
    setEditing(null);
  };

  const cellMenuItems: ContextMenuItem[] = [
    {
      id: "copy-value",
      label: "Copy value",
      icon: <Copy />,
      onClick: copyValue,
    },
  ];

  if (queryResult.rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-text-lighter italic">No data</span>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="group flex items-center justify-between border-border/50 border-b px-3 py-2">
        <span className="text-text-lighter text-xs">{queryResult.rows.length} rows</span>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCreateRow}
          className={cn(
            "rounded-full",
            canCreateRows ? "opacity-0 group-hover:opacity-100" : "cursor-default opacity-30",
          )}
          aria-label="Add row"
          disabled={!canCreateRows}
        >
          <Plus className="text-text-lighter hover:text-text" />
        </Button>
      </div>
      <div className="custom-scrollbar flex-1 overflow-auto px-2 pb-2">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="w-10 border-border/60 border-b bg-primary-bg/95 px-2 py-2 text-left backdrop-blur-sm">
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
                    className="group relative cursor-pointer whitespace-nowrap border-border/60 border-b bg-primary-bg/95 px-2 py-2 text-left transition-colors hover:bg-hover/80"
                    style={{ width: colWidth, minWidth: 60 }}
                    onClick={() => canSortColumns && onColumnSort(col)}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        {info && getColumnIcon(info.type, info.primary_key, isForeignKey(col))}
                        <span className="flex items-center gap-1">
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
                            className="text-text-lighter text-xs opacity-60"
                            title={`FK: ${fk.to_table}.${fk.to_column}`}
                          >
                            FK
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-xs"
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
                        <div className="text-text-lighter text-xs opacity-75">
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
            {queryResult.rows.map((row, ri) => (
              <tr
                key={ri}
                className="cursor-pointer transition-colors hover:bg-hover/25"
                onContextMenu={(e) => canOpenRowMenu && onRowContextMenu(e, ri)}
              >
                <td className="border-border/40 border-b px-2 py-1.5 text-text-lighter">
                  {(currentPage - 1) * pageSize + ri + 1}
                </td>
                {(row as unknown[]).map((cell, ci) => {
                  const col = queryResult.columns[ci];
                  const info = tableMeta.find((c) => c.name === col);
                  const isEditing = editing?.row === ri && editing?.col === col;
                  const isPK = info?.primary_key ?? false;
                  const fk = getForeignKey(col);

                  return (
                    <td
                      key={ci}
                      className={cn(
                        "max-w-[300px] border-border/40 border-b px-2 py-1.5",
                        canEditCells && !isPK && "cursor-pointer hover:bg-hover/40",
                        isPK && "bg-selected/60",
                      )}
                      style={{ width: getColumnWidth(col), minWidth: 60 }}
                      onClick={() => canEditCells && !isPK && !fk && handleCellClick(ri, col, cell)}
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
                          className="w-full rounded-lg border-border/70 bg-secondary-bg/80 text-xs focus:border-accent/60"
                        />
                      ) : (
                        <CellRenderer
                          value={cell}
                          columnName={col}
                          isPrimaryKey={isPK}
                          foreignKey={fk}
                          onFkClick={navigateToReference}
                          onContextMenu={handleCellContextMenu}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
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
