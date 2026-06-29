import {
  DatabaseIcon as Database,
  EyeIcon as Eye,
  HashIcon as Hash,
  PlusIcon as Plus,
  RadioButtonIcon as Radio,
  TableIcon as Table,
} from "@phosphor-icons/react";
import {
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarListItem,
  SidebarPanel,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { cn } from "@/utils/cn";
import { getDatabaseObjectOwner, groupDatabaseObjects } from "../lib/database-catalog";
import type { DatabaseObjectKind, TableInfo } from "../types/common.types";
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
    <SidebarPanel className="w-64 overflow-hidden">
      <SidebarHeader className="group h-9 justify-between border-b border-border/60 px-2">
        <SidebarSectionLabel
          className="h-auto flex-1 px-0 ui-text-sm"
          leading={<Database />}
          trailing={`(${tables.length})`}
        >
          Objects
        </SidebarSectionLabel>
        <SidebarHeaderIconButton
          onClick={onCreateTable}
          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Create table"
          tooltip="Create table"
          tooltipSide="bottom"
        >
          <Plus />
        </SidebarHeaderIconButton>
      </SidebarHeader>
      <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto p-2">
        {objectGroups.map((group, index) => {
          const Icon = groupIcon[group.kind];
          return (
            <div key={group.kind}>
              <SidebarSectionLabel className={cn("px-2.5 py-1 uppercase", index > 0 && "mt-2")}>
                {group.label}
              </SidebarSectionLabel>
              {group.objects.map((t) => {
                const owner = getDatabaseObjectOwner(t);
                return (
                  <SidebarListItem
                    key={t.name}
                    onClick={() => onSelectTable(t.name)}
                    onContextMenu={(e) => onTableContextMenu(e, t.name, group.kind)}
                    className={cn(
                      "h-auto items-start gap-1.5 rounded-lg px-2.5 py-1.5 ui-text-sm leading-[1.35]",
                    )}
                    contentClassName="min-w-0"
                    active={selectedTable === t.name}
                    aria-label={`Select ${group.kind} ${t.name}`}
                    leading={<Icon className="mt-0.5 shrink-0" />}
                  >
                    <span className="flex min-w-0 flex-col items-start leading-[1.35]">
                      <span className="max-w-full truncate">{t.name}</span>
                      {owner && (
                        <span className="max-w-full truncate text-text-lighter">on {owner}</span>
                      )}
                    </span>
                  </SidebarListItem>
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
    </SidebarPanel>
  );
}
