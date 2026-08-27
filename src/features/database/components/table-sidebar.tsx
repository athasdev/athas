import {
  EyeIcon as Eye,
  HashIcon as Hash,
  PlusIcon as Plus,
  RadioButtonIcon as Radio,
  TableIcon as Table,
} from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListItem,
  SidebarPanel,
  SidebarScrollArea,
  SidebarSectionLabel,
  SidebarTitleBar,
} from "@/ui/sidebar";
import { EmptyState } from "@/ui/empty";
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
    <SidebarPanel className="w-64 shrink-0">
      <SidebarTitleBar title={`Objects (${tables.length})`}>
        <SidebarIconButton
          onClick={onCreateTable}
          aria-label="Create table"
          tooltip="Create table"
          tooltipSide="bottom"
        >
          <Plus />
        </SidebarIconButton>
      </SidebarTitleBar>
      <SidebarScrollArea className="min-h-0 flex-1">
        <div className="space-y-1">
          {objectGroups.length === 0 ? (
            <EmptyState layout="sidebar" message="No database objects" />
          ) : null}
          {objectGroups.map((group, index) => {
            const Icon = groupIcon[group.kind];
            return (
              <div key={group.kind} className={index > 0 ? "mt-chrome-loose" : undefined}>
                <SidebarSectionLabel>{group.label}</SidebarSectionLabel>
                {group.objects.map((table) => {
                  const owner = getDatabaseObjectOwner(table);
                  return (
                    <SidebarListItem
                      key={table.name}
                      onClick={() => onSelectTable(table.name)}
                      onContextMenu={(event) => onTableContextMenu(event, table.name, group.kind)}
                      active={selectedTable === table.name}
                      aria-label={`Select ${group.kind} ${table.name}`}
                      leading={<Icon />}
                      description={owner ? `on ${owner}` : undefined}
                    >
                      {table.name}
                    </SidebarListItem>
                  );
                })}
              </div>
            );
          })}
        </div>
      </SidebarScrollArea>
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
