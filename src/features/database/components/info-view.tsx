import { Button } from "@/ui/button";
import { ScrollArea } from "@/ui/scroll-area";
import { getDatabaseObjectOwner, groupDatabaseObjects } from "../lib/database-catalog";
import type { ColumnFilter, DatabaseInfo, TableInfo } from "../types/common.types";
import SqlHistoryList from "./sql-history-list";

interface InfoViewProps {
  fileName: string;
  dbInfo: DatabaseInfo | null;
  selectedTable: string | null;
  columnFilters: ColumnFilter[];
  tables: TableInfo[];
  sqlHistory: string[];
  onTableChange: (tableName: string) => void;
  onQuerySelect: (query: string) => void;
  onQueryRun: (query: string) => void;
  onQueryRemove: (query: string) => void;
  onQueryHistoryClear: () => void;
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
  onQueryRun,
  onQueryRemove,
  onQueryHistoryClear,
}: InfoViewProps) {
  const objectGroups = groupDatabaseObjects(tables);

  return (
    <ScrollArea className="flex-1 font-sans" orientation="both">
      <div className="divide-y divide-border">
        {/* Database stats */}
        <div className="p-3">
          <div className="mb-1 ui-text-sm text-foreground">{fileName}</div>
          <div className="flex gap-4 ui-text-sm text-subtle-foreground">
            <span>{dbInfo?.tables || 0} tables</span>
            <span>{dbInfo?.indexes || 0} indexes</span>
            <span>v{dbInfo?.version || "0"}</span>
            {selectedTable && <span>current: {selectedTable}</span>}
            {columnFilters.length > 0 && <span>{columnFilters.length} filters</span>}
          </div>
        </div>

        {/* Tables */}
        <div className="p-3">
          <div className="mb-2 ui-text-sm text-subtle-foreground">objects</div>
          <div className="space-y-3">
            {objectGroups.map((group) => (
              <div key={group.kind}>
                <div className="mb-1 ui-text-sm text-subtle-foreground uppercase tracking-wide">
                  {group.label} ({group.objects.length})
                </div>
                <div className="space-y-1">
                  {group.objects.map((table) => {
                    const owner = getDatabaseObjectOwner(table);
                    return (
                      <Button
                        key={table.name}
                        onClick={() => onTableChange(table.name)}
                        variant="ghost"
                        size="xs"
                        className={`block h-auto w-full justify-start px-2 py-1 text-left ui-text-sm hover:bg-accent ${
                          selectedTable === table.name ? "bg-selected" : ""
                        }`}
                      >
                        <span className="flex min-w-0 flex-col items-start">
                          <span className="max-w-full truncate">{table.name}</span>
                          {owner && (
                            <span className="max-w-full truncate ui-text-sm text-subtle-foreground">
                              on {owner}
                            </span>
                          )}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {sqlHistory.length > 0 && (
          <div className="p-3">
            <SqlHistoryList
              queries={sqlHistory}
              title="Recent queries"
              onSelect={onQuerySelect}
              onRun={onQueryRun}
              onRemove={onQueryRemove}
              onClear={onQueryHistoryClear}
            />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
