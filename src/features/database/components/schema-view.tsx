import { Funnel as Filter } from "@phosphor-icons/react";
import { Button } from "@/ui/button";
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
        <div className="ui-font ui-text-md">{selectedTable}</div>
        <div className="ui-font ui-text-sm text-text-lighter">{tableMeta.length} columns</div>
      </div>

      <div className="divide-y divide-border">
        {tableMeta.map((column) => (
          <div
            key={column.name}
            className="flex items-center justify-between px-3 py-2 hover:bg-hover"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {getColumnIcon(column.type, column.primary_key)}
              <div className="ui-font ui-text-md truncate">{column.name}</div>
              <div className="ui-font ui-text-sm text-text-lighter">{column.type}</div>
              {column.primary_key && <div className="ui-font ui-text-sm text-text-lighter">PK</div>}
              {column.notnull && <div className="ui-font ui-text-sm text-text-lighter">NN</div>}
              {column.default_value && (
                <div
                  className="ui-font ui-text-sm truncate text-text-lighter"
                  title={`default: ${column.default_value}`}
                >
                  def: {column.default_value}
                </div>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => onAddColumnFilter(column.name)}
              className="text-text-lighter opacity-60 hover:text-text hover:opacity-100"
              tooltip="Filter by this column"
            >
              <Filter />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
