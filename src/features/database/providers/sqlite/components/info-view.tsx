import { Button } from "@/ui/button";
import type { ColumnFilter, DatabaseInfo, TableInfo } from "../../../models/common.types";

interface InfoViewProps {
  fileName: string;
  dbInfo: DatabaseInfo | null;
  selectedTable: string | null;
  columnFilters: ColumnFilter[];
  tables: TableInfo[];
  sqlHistory: string[];
  onTableChange: (tableName: string) => void;
  onQuerySelect: (query: string) => void;
}

export default function InfoView({
  fileName,
  dbInfo,
  selectedTable,
  columnFilters,
  tables,
  sqlHistory,
  onTableChange,
  onQuerySelect,
}: InfoViewProps) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="divide-y divide-border">
        {/* Database stats */}
        <div className="p-3">
          <div className="ui-font mb-1 text-sm">{fileName}</div>
          <div className="ui-font flex gap-4 text-text-lighter text-xs">
            <span>{dbInfo?.tables || 0} tables</span>
            <span>{dbInfo?.indexes || 0} indexes</span>
            <span>v{dbInfo?.version || "0"}</span>
            {selectedTable && <span>current: {selectedTable}</span>}
            {columnFilters.length > 0 && <span>{columnFilters.length} filters</span>}
          </div>
        </div>

        {/* Tables */}
        <div className="p-3">
          <div className="ui-font mb-2 text-text-lighter text-xs">objects</div>
          <div className="space-y-1">
            {tables.map((table) => (
              <Button
                key={table.name}
                onClick={() => onTableChange(table.name)}
                variant="ghost"
                size="sm"
                className={`ui-font block h-auto w-full justify-start px-2 py-1 text-left text-xs hover:bg-hover ${
                  selectedTable === table.name ? "bg-selected" : ""
                }`}
              >
                {table.name}
                {table.kind === "subscription" ? " [subscription]" : ""}
              </Button>
            ))}
          </div>
        </div>

        {/* SQL History */}
        {sqlHistory.length > 0 && (
          <div className="p-3">
            <div className="ui-font mb-2 text-text-lighter text-xs">recent queries</div>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {sqlHistory.map((query, index) => (
                <Button
                  key={index}
                  onClick={() => onQuerySelect(query)}
                  variant="ghost"
                  size="sm"
                  className="ui-font block h-auto w-full truncate justify-start px-2 py-1 text-left text-xs hover:bg-hover"
                  title={query}
                >
                  {query}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
