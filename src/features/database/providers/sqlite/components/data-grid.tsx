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
import { ContextMenu, type ContextMenuItem } from "@/ui/context-menu";
import { cn } from "@/utils/cn";
import { useCellCopy } from "../hooks/use-cell-copy";
import { useColumnResize } from "../hooks/use-column-resize";
import { useFkNavigation } from "../hooks/use-fk-navigation";
import type { ColumnInfo } from "../types";
import CellRenderer from "./cell-renderer";

const COLUMN_ICONS: Record<string, { icon: typeof Hash; color: string }> = {
  int: { icon: Hash, color: "text-accent" },
  num: { icon: Hash, color: "text-accent" },
  text: { icon: Type, color: "text-green-500" },
  varchar: { icon: Type, color: "text-green-500" },
  char: { icon: Type, color: "text-green-500" },
  date: { icon: Calendar, color: "text-purple-500" },
  time: { icon: Calendar, color: "text-purple-500" },
  blob: { icon: FileText, color: "text-red-500" },
  binary: { icon: FileText, color: "text-red-500" },
};

function getColumnIcon(type: string, isPrimaryKey: boolean, isForeignKey: boolean) {
  if (isPrimaryKey) return <Key size={12} className="text-text-lighter" />;
  if (isForeignKey) return <Link size={12} className="text-accent" />;
  const lowerType = type.toLowerCase();
  for (const [key, { icon: Icon, color }] of Object.entries(COLUMN_ICONS)) {
    if (lowerType.includes(key)) return <Icon size={12} className={color} />;
  }
  return <Type size={12} className="text-text-lighter" />;
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
}: DataGridProps) {
  const [editing, setEditing] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState("");

  const { getColumnWidth, handleResizeStart, handleResizeMove, handleResizeEnd } =
    useColumnResize(tableName);
  const { cellMenu, handleCellContextMenu, copyValue, closeCellMenu } = useCellCopy();
  const { getForeignKey, isForeignKey, navigateToReference } = useFkNavigation();

  const handleCellClick = (row: number, col: string, value: unknown) => {
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
      icon: <Copy size={12} />,
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
      <div className="group flex items-center justify-between px-3 py-2">
        <span className="text-text-lighter text-xs">{queryResult.rows.length} rows</span>
        <button
          onClick={onCreateRow}
          className="rounded-full border border-transparent px-1.5 py-1 opacity-0 transition-colors hover:border-border/70 hover:bg-hover group-hover:opacity-100"
          aria-label="Add row"
        >
          <Plus size={10} className="text-text-lighter hover:text-text" />
        </button>
      </div>
      <div className="custom-scrollbar flex-1 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-secondary-bg/90 backdrop-blur-sm">
              <th className="w-10 border-border/60 border-b px-2 py-2 text-left">#</th>
              {queryResult.columns.map((col, i) => {
                const info = tableMeta.find((c) => c.name === col);
                const sorted = sortColumn === col;
                const fk = getForeignKey(col);
                const colWidth = getColumnWidth(col);

                return (
                  <th
                    key={i}
                    className="group relative cursor-pointer whitespace-nowrap border-border/60 border-b px-2 py-2 text-left transition-colors hover:bg-hover"
                    style={{ width: colWidth, minWidth: 60 }}
                    onClick={() => onColumnSort(col)}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        {info && getColumnIcon(info.type, info.primary_key, isForeignKey(col))}
                        <span className="flex items-center gap-1">
                          {col}
                          {sorted &&
                            (sortDirection === "asc" ? (
                              <ArrowUp size={10} className="text-accent" />
                            ) : (
                              <ArrowDown size={10} className="text-accent" />
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
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddColumnFilter(col);
                          }}
                          className="opacity-0 group-hover:opacity-100"
                          aria-label={`Filter by ${col}`}
                        >
                          <Filter size={10} className="text-text-lighter hover:text-text" />
                        </button>
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
                className="cursor-pointer border-border/50 border-b hover:bg-hover/40"
                onContextMenu={(e) => onRowContextMenu(e, ri)}
              >
                <td className="border-border/60 border-b px-2 py-1.5 text-text-lighter">
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
                        "max-w-[300px] border-border/60 border-b px-2 py-1.5",
                        !isPK && "cursor-pointer hover:bg-hover/50",
                        isPK && "bg-amber-500/10",
                      )}
                      style={{ width: getColumnWidth(col), minWidth: 60 }}
                      onClick={() => !isPK && !fk && handleCellClick(ri, col, cell)}
                    >
                      {isEditing ? (
                        <input
                          ref={(el) => el?.focus()}
                          type={info?.type.toLowerCase().includes("int") ? "number" : "text"}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSubmit();
                            if (e.key === "Escape") setEditing(null);
                          }}
                          onBlur={handleSubmit}
                          className="w-full rounded bg-secondary-bg/60 p-1 text-xs outline-none"
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
