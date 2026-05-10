import { Database, Eye, Hash, Plus, RadioButton as Radio, Table } from "@phosphor-icons/react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import { getDatabaseObjectOwner, groupDatabaseObjects } from "../lib/database-catalog";
import type { DatabaseObjectKind, TableInfo } from "../models/common.types";
import SqlHistoryList from "./sql-history-list";

interface TableSidebarProps {
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onTableContextMenu: (e: React.MouseEvent, name: string, objectKind: DatabaseObjectKind) => void;
  onCreateTable: () => void;
  sqlHistory: string[];
  onSelectHistory: (query: string) => void;
  onRunHistory: (query: string) => void;
  onRemoveHistory: (query: string) => void;
  onClearHistory: () => void;
}

export default function TableSidebar({
  tables,
  selectedTable,
  onSelectTable,
  onTableContextMenu,
  onCreateTable,
  sqlHistory,
  onSelectHistory,
  onRunHistory,
  onRemoveHistory,
  onClearHistory,
}: TableSidebarProps) {
  const objectGroups = groupDatabaseObjects(tables);
  const groupIcon = {
    table: Table,
    view: Eye,
    materialized_view: Eye,
    subscription: Radio,
    index: Hash,
  } satisfies Record<DatabaseObjectKind, typeof Table>;

  return (
    <div className="flex w-64 flex-col overflow-hidden rounded-lg border border-border/70 bg-primary-bg">
      <div className="group border-border/70 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 ui-font ui-text-sm text-text-lighter">
            <Database />
            Objects ({tables.length})
          </div>
          <Button
            onClick={onCreateTable}
            variant="ghost"
            className="rounded-md opacity-0 group-hover:opacity-100"
            aria-label="Create table"
            compact
          >
            <Plus className="text-text-lighter hover:text-text" />
          </Button>
        </div>
      </div>
      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
        {objectGroups.map((group, index) => {
          const Icon = groupIcon[group.kind];
          return (
            <div key={group.kind}>
              <div
                className={cn(
                  "px-2.5 py-1 ui-font ui-text-xs text-text-lighter uppercase tracking-wide",
                  index > 0 && "mt-2",
                )}
              >
                {group.label}
              </div>
              {group.objects.map((t) => {
                const owner = getDatabaseObjectOwner(t);
                return (
                  <Button
                    key={t.name}
                    onClick={() => onSelectTable(t.name)}
                    onContextMenu={(e) => onTableContextMenu(e, t.name, group.kind)}
                    variant="ghost"
                    compact
                    className={cn(
                      "flex h-auto w-full items-start justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left ui-text-xs hover:bg-hover",
                      selectedTable === t.name && "bg-selected text-text",
                    )}
                    aria-label={`Select ${group.kind} ${t.name}`}
                  >
                    <Icon className="mt-0.5 shrink-0" />
                    <span className="flex min-w-0 flex-col items-start">
                      <span className="max-w-full truncate">{t.name}</span>
                      {owner && (
                        <span className="max-w-full truncate text-text-lighter">on {owner}</span>
                      )}
                    </span>
                  </Button>
                );
              })}
            </div>
          );
        })}
      </div>
      <SqlHistoryList
        queries={sqlHistory}
        compact
        onSelect={onSelectHistory}
        onRun={onRunHistory}
        onRemove={onRemoveHistory}
        onClear={onClearHistory}
      />
    </div>
  );
}
