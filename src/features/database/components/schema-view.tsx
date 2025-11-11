import { Filter } from "lucide-react";
import type { ColumnInfo } from "../models/common.types";

interface SchemaViewProps {
  selectedTable: string;
  tableMeta: ColumnInfo[];
  onAddColumnFilter: (column: string) => void;
  getColumnIcon: (type: string, isPrimaryKey: boolean) => React.ReactNode;
}

export default function SchemaView({
  selectedTable,
  tableMeta,
  onAddColumnFilter,
  getColumnIcon,
}: SchemaViewProps) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="border-border border-b bg-secondary-bg p-3">
        <div className="ui-font text-sm">{selectedTable}</div>
        <div className="ui-font text-text-lighter text-xs">{tableMeta.length} columns</div>
      </div>

      <div className="divide-y divide-border">
        {tableMeta.map((column) => (
          <div
            key={column.name}
            className="flex items-center justify-between px-3 py-2 hover:bg-hover"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {getColumnIcon(column.type, column.primary_key)}
              <div className="ui-font truncate text-sm">{column.name}</div>
              <div className="ui-font text-text-lighter text-xs">{column.type}</div>
              {column.primary_key && <div className="ui-font text-text-lighter text-xs">PK</div>}
              {column.notnull && <div className="ui-font text-text-lighter text-xs">NN</div>}
              {column.default_value && (
                <div
                  className="ui-font truncate text-text-lighter text-xs"
                  title={`default: ${column.default_value}`}
                >
                  def: {column.default_value}
                </div>
              )}
            </div>
            <button
              onClick={() => onAddColumnFilter(column.name)}
              className="ui-font px-2 py-1 text-text-lighter text-xs opacity-60 transition-colors hover:text-text hover:opacity-100"
              title="Filter by this column"
            >
              <Filter size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
