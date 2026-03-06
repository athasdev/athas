import { Code, Database, Plus, Table } from "lucide-react";
import { cn } from "@/utils/cn";

interface TableSidebarProps {
  tables: { name: string }[];
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
  return (
    <div className="flex w-64 flex-col overflow-hidden rounded-2xl bg-primary-bg/75">
      <div className="group p-3 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-text-lighter text-xs">
            <Database size={12} />
            Tables ({tables.length})
          </div>
          <button
            onClick={onCreateTable}
            className="rounded-full border border-transparent px-1.5 py-1 opacity-0 transition-colors hover:border-border/70 hover:bg-hover group-hover:opacity-100"
            aria-label="Create table"
          >
            <Plus size={10} className="text-text-lighter hover:text-text" />
          </button>
        </div>
      </div>
      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
        {tables.map((t) => (
          <button
            key={t.name}
            onClick={() => onSelectTable(t.name)}
            onContextMenu={(e) => onTableContextMenu(e, t.name)}
            className={cn(
              "flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-hover",
              selectedTable === t.name && "bg-selected text-text",
            )}
            aria-label={`Select table ${t.name}`}
          >
            <Table size={12} className="shrink-0" />
            <span className="truncate">{t.name}</span>
          </button>
        ))}
      </div>
      {sqlHistory.length > 0 && (
        <div className="mx-2 mb-2 rounded-xl bg-secondary-bg/50">
          <div className="p-2">
            <div className="px-2 py-1 font-medium text-text-lighter text-xs uppercase">Recent</div>
          </div>
          <div className="max-h-32 overflow-y-auto pb-1">
            {sqlHistory.map((q, i) => (
              <button
                key={i}
                onClick={() => onSelectHistory(q)}
                className="mx-1 block w-[calc(100%-0.5rem)] truncate rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-hover"
                title={q}
                aria-label={`Run query: ${q}`}
              >
                <Code size={10} className="mr-1.5 inline" />
                {q.length > 25 ? `${q.slice(0, 25)}...` : q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
