import { Code, Database, Plus, RadioButton as Radio, Table } from "@phosphor-icons/react";
import { Button } from "@/ui/button";
import { cn } from "@/utils/cn";
import type { TableInfo } from "../sqlite-types";

interface TableSidebarProps {
  tables: TableInfo[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onTableContextMenu: (e: React.MouseEvent, name: string) => void;
  onCreateTable: () => void;
  sqlHistory: string[];
  onSelectHistory: (query: string) => void;
}

export default function TableSidebar({
  tables,
  selectedTable,
  onSelectTable,
  onTableContextMenu,
  onCreateTable,
  sqlHistory,
  onSelectHistory,
}: TableSidebarProps) {
  const tableObjects = tables.filter((table) => (table.kind ?? "table") === "table");
  const subscriptionObjects = tables.filter((table) => table.kind === "subscription");

  return (
    <div className="flex w-64 flex-col overflow-hidden rounded-2xl bg-primary-bg/75">
      <div className="group p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-text-lighter text-xs">
            <Database />
            Objects ({tables.length})
          </div>
          <Button
            onClick={onCreateTable}
            variant="ghost"
            size="icon-sm"
            className="rounded-full opacity-0 group-hover:opacity-100"
            aria-label="Create table"
          >
            <Plus className="text-text-lighter hover:text-text" />
          </Button>
        </div>
      </div>
      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
        {tableObjects.length > 0 && (
          <>
            <div className="px-2.5 py-1 text-text-lighter text-[11px] uppercase tracking-wide">
              Tables
            </div>
            {tableObjects.map((t) => (
              <Button
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                onContextMenu={(e) => onTableContextMenu(e, t.name)}
                variant="ghost"
                size="sm"
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-hover",
                  selectedTable === t.name && "bg-selected text-text",
                )}
                aria-label={`Select table ${t.name}`}
              >
                <Table className="shrink-0" />
                <span className="truncate">{t.name}</span>
              </Button>
            ))}
          </>
        )}
        {subscriptionObjects.length > 0 && (
          <>
            <div className="mt-2 px-2.5 py-1 text-text-lighter text-[11px] uppercase tracking-wide">
              Subscriptions
            </div>
            {subscriptionObjects.map((t) => (
              <Button
                key={t.name}
                onClick={() => onSelectTable(t.name)}
                variant="ghost"
                size="sm"
                className={cn(
                  "flex h-auto w-full items-center justify-start gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-hover",
                  selectedTable === t.name && "bg-selected text-text",
                )}
                aria-label={`Select subscription ${t.name}`}
              >
                <Radio className="shrink-0" />
                <span className="truncate">{t.name}</span>
              </Button>
            ))}
          </>
        )}
      </div>
      {sqlHistory.length > 0 && (
        <div className="mx-2 mb-2 rounded-xl bg-secondary-bg/50">
          <div className="p-2">
            <div className="px-2 py-1 font-medium text-text-lighter text-xs uppercase">Recent</div>
          </div>
          <div className="max-h-32 overflow-y-auto pb-1">
            {sqlHistory.map((q, i) => (
              <Button
                key={i}
                onClick={() => onSelectHistory(q)}
                variant="ghost"
                size="sm"
                className="mx-1 block h-auto w-[calc(100%-0.5rem)] truncate rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-hover"
                tooltip={q}
                aria-label={`Run query: ${q}`}
              >
                <Code className="mr-1.5 inline" />
                {q.length > 25 ? `${q.slice(0, 25)}...` : q}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
