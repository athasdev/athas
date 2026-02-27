import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Code,
  Copy,
  Database,
  Download,
  FileText,
  Filter,
  Hash,
  Info,
  Key,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Table,
  Type,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useUIState } from "@/stores/ui-state-store";
import Button from "@/ui/button";
import Dropdown from "@/ui/dropdown";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";
import { cn } from "@/utils/cn";
import type { ColumnFilter, ColumnInfo, ViewMode } from "../../models/common.types";
import { SqliteRowMenu, SqliteTableMenu } from "./components/context-menus";
import { CreateRowModal, CreateTableModal, EditRowModal } from "./components/crud-modals";
import { useSqliteStore } from "./stores/sqlite-store";

export interface SQLiteViewerProps {
  databasePath: string;
}

const COLUMN_ICONS: Record<string, { icon: typeof Hash; color: string }> = {
  int: { icon: Hash, color: "text-blue-500" },
  num: { icon: Hash, color: "text-blue-500" },
  text: { icon: Type, color: "text-green-500" },
  varchar: { icon: Type, color: "text-green-500" },
  char: { icon: Type, color: "text-green-500" },
  date: { icon: Calendar, color: "text-purple-500" },
  time: { icon: Calendar, color: "text-purple-500" },
  blob: { icon: FileText, color: "text-red-500" },
  binary: { icon: FileText, color: "text-red-500" },
};

function getColumnIcon(type: string, isPrimaryKey: boolean) {
  if (isPrimaryKey) return <Key size={12} className="text-text-lighter" />;
  const lowerType = type.toLowerCase();
  for (const [key, { icon: Icon, color }] of Object.entries(COLUMN_ICONS)) {
    if (lowerType.includes(key)) return <Icon size={12} className={color} />;
  }
  return <Type size={12} className="text-text-lighter" />;
}

const FILTER_OPERATORS = [
  { value: "equals", label: "=" },
  { value: "contains", label: "∋" },
  { value: "startsWith", label: "^" },
  { value: "endsWith", label: "$" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
  { value: "between", label: "⇋" },
];

const PAGE_SIZES = [
  { value: "10", label: "10" },
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "500", label: "500" },
];

export default function SQLiteViewer({ databasePath }: SQLiteViewerProps) {
  const store = useSqliteStore();
  const { actions } = store;
  const { setSqliteTableMenu, setSqliteRowMenu } = useUIState();

  const [viewMode, setViewMode] = useState<ViewMode>("data");
  const [showColumnTypes, setShowColumnTypes] = useState(true);
  const [createRowModal, setCreateRowModal] = useState({ isOpen: false, tableName: "" });
  const [editRowModal, setEditRowModal] = useState<{
    isOpen: boolean;
    tableName: string;
    rowData: Record<string, unknown>;
  }>({ isOpen: false, tableName: "", rowData: {} });
  const [createTableModal, setCreateTableModal] = useState(false);

  useEffect(() => {
    actions.init(databasePath);
    return () => actions.reset();
  }, [databasePath, actions]);

  const handleTableContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    setSqliteTableMenu({ x: e.clientX, y: e.clientY, tableName });
  };

  const handleRowContextMenu = (e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    if (!store.queryResult) return;
    const row = store.queryResult.rows[rowIndex];
    const rowData: Record<string, unknown> = {};
    store.queryResult.columns.forEach((col, i) => {
      rowData[col] = row[i];
    });
    setSqliteRowMenu({ x: e.clientX, y: e.clientY, tableName: store.selectedTable || "", rowData });
  };

  const handleEditRow = (tableName: string, rowData: Record<string, unknown>) => {
    setEditRowModal({ isOpen: true, tableName, rowData });
  };

  const handleDeleteRow = async (_: string, rowData: Record<string, unknown>) => {
    const pk = store.tableMeta.find((c) => c.primary_key);
    if (!pk) return;
    const pkValue = rowData[pk.name];
    if (pkValue != null) await actions.deleteRow(pk.name, pkValue);
  };

  const handleSubmitEditRow = async (values: Record<string, unknown>) => {
    const pk = store.tableMeta.find((c) => c.primary_key);
    if (!pk) return;
    const pkValue = editRowModal.rowData[pk.name];
    if (pkValue != null) await actions.updateRow(pk.name, pkValue, values);
  };

  const exportAsCSV = () => {
    if (!store.queryResult) return;
    const headers = store.queryResult.columns.map((c) => `"${c}"`).join(",");
    const rows = store.queryResult.rows
      .map((row) =>
        row
          .map((cell) => {
            if (cell === null) return '""';
            if (typeof cell === "object") return `"${JSON.stringify(cell).replace(/"/g, '""')}"`;
            return `"${String(cell).replace(/"/g, '""')}"`;
          })
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`${headers}\n${rows}`], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${store.selectedTable || "result"}_${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyAsJSON = async () => {
    if (!store.queryResult) return;
    const data = store.queryResult.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      store.queryResult!.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-secondary-bg/30 text-text">
      <Header
        fileName={store.fileName}
        dbInfo={store.dbInfo}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isCustomQuery={store.isCustomQuery}
        showColumnTypes={showColumnTypes}
        setShowColumnTypes={setShowColumnTypes}
        setIsCustomQuery={actions.setIsCustomQuery}
        hasData={!!store.queryResult}
        exportAsCSV={exportAsCSV}
        copyAsJSON={copyAsJSON}
      />

      <div className="flex min-h-0 flex-1 gap-2 p-2 pt-1.5">
        <Sidebar
          tables={store.tables}
          selectedTable={store.selectedTable}
          onSelectTable={(name) => {
            actions.selectTable(name);
            setViewMode("data");
          }}
          onTableContextMenu={handleTableContextMenu}
          onCreateTable={() => setCreateTableModal(true)}
          sqlHistory={store.sqlHistory}
          onSelectHistory={(query) => {
            actions.setCustomQuery(query);
            actions.setIsCustomQuery(true);
          }}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-primary-bg/85">
          <QueryBar
            searchTerm={store.searchTerm}
            setSearchTerm={actions.setSearchTerm}
            customQuery={store.customQuery}
            setCustomQuery={actions.setCustomQuery}
            isCustomQuery={store.isCustomQuery}
            setIsCustomQuery={actions.setIsCustomQuery}
            executeCustomQuery={actions.executeCustomQuery}
            isLoading={store.isLoading}
          />

          {viewMode === "data" && store.columnFilters.length > 0 && (
            <ColumnFilters
              filters={store.columnFilters}
              columns={store.tableMeta}
              onUpdate={actions.updateColumnFilter}
              onRemove={actions.removeColumnFilter}
              onClear={actions.clearFilters}
            />
          )}

          {store.error && (
            <div className="mx-3 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300 text-xs">
              {store.error}
            </div>
          )}

          {store.isLoading && <LoadingIndicator />}

          {!store.isLoading && viewMode === "data" && store.queryResult && (
            <DataGrid
              queryResult={store.queryResult}
              tableMeta={store.tableMeta}
              currentPage={store.currentPage}
              pageSize={store.pageSize}
              sortColumn={store.sortColumn}
              sortDirection={store.sortDirection}
              showColumnTypes={showColumnTypes}
              onColumnSort={actions.toggleSort}
              onAddColumnFilter={actions.addColumnFilter}
              onRowContextMenu={handleRowContextMenu}
              onCellEdit={actions.updateCell}
              onCreateRow={() =>
                store.selectedTable &&
                setCreateRowModal({ isOpen: true, tableName: store.selectedTable })
              }
            />
          )}

          {!store.isLoading &&
            viewMode === "schema" &&
            store.selectedTable &&
            store.tableMeta.length > 0 && (
              <SchemaView
                tableName={store.selectedTable}
                columns={store.tableMeta}
                onAddFilter={actions.addColumnFilter}
              />
            )}

          {!store.isLoading && viewMode === "info" && (
            <InfoView
              fileName={store.fileName}
              dbInfo={store.dbInfo}
              tables={store.tables}
              selectedTable={store.selectedTable}
              columnFilters={store.columnFilters}
              sqlHistory={store.sqlHistory}
              onSelectTable={(name) => {
                actions.selectTable(name);
                setViewMode("data");
              }}
              onSelectHistory={(query) => {
                actions.setCustomQuery(query);
                actions.setIsCustomQuery(true);
                setViewMode("data");
              }}
            />
          )}

          {!store.isLoading &&
            viewMode === "data" &&
            store.queryResult &&
            !store.isCustomQuery &&
            store.totalPages > 1 && (
              <Pagination
                currentPage={store.currentPage}
                totalPages={store.totalPages}
                pageSize={store.pageSize}
                onPageChange={actions.setCurrentPage}
                onPageSizeChange={actions.setPageSize}
              />
            )}
        </div>
      </div>

      <SqliteTableMenu
        onCreateRow={(tableName) => setCreateRowModal({ isOpen: true, tableName })}
        onDeleteTable={actions.dropTable}
      />
      <SqliteRowMenu onEditRow={handleEditRow} onDeleteRow={handleDeleteRow} />

      <CreateRowModal
        isOpen={createRowModal.isOpen}
        onClose={() => setCreateRowModal({ isOpen: false, tableName: "" })}
        tableName={createRowModal.tableName}
        columns={store.tableMeta.filter((c) => c.name.toLowerCase() !== "rowid")}
        onSubmit={actions.insertRow}
      />

      <EditRowModal
        isOpen={editRowModal.isOpen}
        onClose={() => setEditRowModal({ isOpen: false, tableName: "", rowData: {} })}
        tableName={editRowModal.tableName}
        columns={store.tableMeta.filter((c) => c.name.toLowerCase() !== "rowid")}
        initialData={editRowModal.rowData}
        onSubmit={handleSubmitEditRow}
      />

      <CreateTableModal
        isOpen={createTableModal}
        onClose={() => setCreateTableModal(false)}
        onSubmit={actions.createTable}
      />
    </div>
  );
}

// Sub-components

interface HeaderProps {
  fileName: string;
  dbInfo: { tables: number; indexes: number } | null;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  isCustomQuery: boolean;
  showColumnTypes: boolean;
  setShowColumnTypes: (show: boolean) => void;
  setIsCustomQuery: (is: boolean) => void;
  hasData: boolean;
  exportAsCSV: () => void;
  copyAsJSON: () => void;
}

function Header({
  fileName,
  dbInfo,
  viewMode,
  setViewMode,
  isCustomQuery,
  showColumnTypes,
  setShowColumnTypes,
  setIsCustomQuery,
  hasData,
  exportAsCSV,
  copyAsJSON,
}: HeaderProps) {
  const tabs: { mode: ViewMode; icon: typeof Table; label: string }[] = [
    { mode: "data", icon: Table, label: "Data" },
    { mode: "schema", icon: Settings, label: "Schema" },
    { mode: "info", icon: Info, label: "Info" },
  ];

  return (
    <div className="mx-2 mt-2 rounded-2xl bg-primary-bg/85 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 rounded-full bg-secondary-bg/70 px-2.5 py-1">
            <Database size={14} className="text-text-lighter" />
            <span className="text-sm">{fileName}</span>
            {dbInfo && (
              <span className="text-text-lighter text-xs">
                {dbInfo.tables}t {dbInfo.indexes}i
              </span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-full bg-secondary-bg/60 p-0.5">
            {tabs.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={cn(
                  "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors",
                  viewMode === mode
                    ? "bg-selected text-text"
                    : "text-text-lighter hover:bg-hover hover:text-text",
                )}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {viewMode === "data" && !isCustomQuery && (
            <button
              onClick={() => setShowColumnTypes(!showColumnTypes)}
              className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
            >
              <Type size={12} />
              Types
            </button>
          )}
          {viewMode === "data" && (
            <button
              onClick={() => setIsCustomQuery(true)}
              className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
              disabled={isCustomQuery}
            >
              <Code size={12} />
              SQL
            </button>
          )}
          {hasData && (
            <>
              <button
                onClick={exportAsCSV}
                className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
              >
                <Download size={12} />
                Export
              </button>
              <button
                onClick={copyAsJSON}
                className="flex items-center gap-1 rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
              >
                <Copy size={12} />
                JSON
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface SidebarProps {
  tables: { name: string }[];
  selectedTable: string | null;
  onSelectTable: (name: string) => void;
  onTableContextMenu: (e: React.MouseEvent, name: string) => void;
  onCreateTable: () => void;
  sqlHistory: string[];
  onSelectHistory: (query: string) => void;
}

function Sidebar({
  tables,
  selectedTable,
  onSelectTable,
  onTableContextMenu,
  onCreateTable,
  sqlHistory,
  onSelectHistory,
}: SidebarProps) {
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

interface QueryBarProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  customQuery: string;
  setCustomQuery: (query: string) => void;
  isCustomQuery: boolean;
  setIsCustomQuery: (is: boolean) => void;
  executeCustomQuery: () => void;
  isLoading: boolean;
}

function QueryBar({
  searchTerm,
  setSearchTerm,
  customQuery,
  setCustomQuery,
  isCustomQuery,
  setIsCustomQuery,
  executeCustomQuery,
  isLoading,
}: QueryBarProps) {
  if (isCustomQuery) {
    return (
      <div className="px-3 py-2">
        <Textarea
          value={customQuery}
          onChange={(e) => setCustomQuery(e.target.value)}
          className="mb-1 h-20 resize-none rounded-xl border-border/70 bg-secondary-bg/60"
          placeholder="SELECT * FROM table_name"
          disabled={isLoading}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={() => setIsCustomQuery(false)} variant="ghost" size="sm">
            <X size={14} className="mr-1" />
            Cancel
          </Button>
          <Button
            onClick={executeCustomQuery}
            variant="default"
            size="sm"
            disabled={isLoading || !customQuery.trim()}
          >
            <Code size={14} className="mr-1" />
            Execute
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            leftIcon={Search}
            size="sm"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="-translate-y-1/2 absolute top-1/2 right-2 text-text-lighter hover:text-text"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <Button onClick={() => setIsCustomQuery(true)} variant="default" size="sm">
          <Code size={14} className="mr-1" />
          SQL
        </Button>
      </div>
    </div>
  );
}

interface ColumnFiltersProps {
  filters: ColumnFilter[];
  columns: ColumnInfo[];
  onUpdate: (index: number, updates: Partial<ColumnFilter>) => void;
  onRemove: (index: number) => void;
  onClear: () => void;
}

function ColumnFilters({ filters, columns, onUpdate, onRemove, onClear }: ColumnFiltersProps) {
  return (
    <div className="mx-3 mb-2 rounded-xl bg-secondary-bg/60 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-text-lighter text-xs">{filters.length} filters</span>
        <button
          onClick={onClear}
          className="rounded-full border border-transparent px-2 py-0.5 text-text-lighter text-xs hover:border-border/70 hover:bg-hover hover:text-text"
        >
          clear
        </button>
      </div>
      <div className="space-y-1">
        {filters.map((f, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <Dropdown
              value={f.column}
              options={columns.map((c) => ({ value: c.name, label: c.name }))}
              onChange={(v) => onUpdate(i, { column: v })}
              size="xs"
              className="min-w-20"
            />
            <Dropdown
              value={f.operator}
              options={FILTER_OPERATORS}
              onChange={(v) => onUpdate(i, { operator: v as ColumnFilter["operator"] })}
              size="xs"
              className="min-w-12"
            />
            <Input
              value={f.value}
              onChange={(e) => onUpdate(i, { value: e.target.value })}
              placeholder="value"
              size="xs"
              className="flex-1"
            />
            {f.operator === "between" && (
              <Input
                value={f.value2 || ""}
                onChange={(e) => onUpdate(i, { value2: e.target.value })}
                placeholder="to"
                size="xs"
                className="flex-1"
              />
            )}
            <button onClick={() => onRemove(i)} className="text-text-lighter hover:text-red-500">
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadingIndicator() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex items-center gap-2 text-sm text-text-lighter">
        <RefreshCw size={16} className="animate-spin" />
        Loading...
      </div>
    </div>
  );
}

interface DataGridProps {
  queryResult: { columns: string[]; rows: unknown[][] };
  tableMeta: ColumnInfo[];
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

function DataGrid({
  queryResult,
  tableMeta,
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
                return (
                  <th
                    key={i}
                    className="group cursor-pointer whitespace-nowrap border-border/60 border-b px-2 py-2 text-left transition-colors hover:bg-hover"
                    onClick={() => onColumnSort(col)}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        {info && getColumnIcon(info.type, info.primary_key)}
                        <span className="flex items-center gap-1">
                          {col}
                          {sorted &&
                            (sortDirection === "asc" ? (
                              <ArrowUp size={10} className="text-blue-500" />
                            ) : (
                              <ArrowDown size={10} className="text-blue-500" />
                            ))}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddColumnFilter(col);
                          }}
                          className="opacity-0 group-hover:opacity-100"
                        >
                          <Filter size={10} className="text-text-lighter hover:text-text" />
                        </button>
                      </div>
                      {showColumnTypes && info && (
                        <div className="text-text-lighter text-xs opacity-75">
                          {info.type}
                          {info.primary_key && " • PK"}
                          {info.notnull && " • NN"}
                        </div>
                      )}
                    </div>
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
                  const isPK = info?.primary_key;

                  return (
                    <td
                      key={ci}
                      className={cn(
                        "max-w-[300px] border-border/60 border-b px-2 py-1.5",
                        !isPK && "cursor-pointer hover:bg-hover/50",
                        isPK && "bg-amber-500/10",
                      )}
                      onClick={() => !isPK && handleCellClick(ri, col, cell)}
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
                      ) : cell === null ? (
                        <span className="text-text-lighter italic">NULL</span>
                      ) : typeof cell === "object" ? (
                        <span className="block truncate text-blue-500">{JSON.stringify(cell)}</span>
                      ) : (
                        <span
                          className={cn("block truncate", isPK && "font-semibold text-amber-600")}
                        >
                          {String(cell)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface SchemaViewProps {
  tableName: string;
  columns: ColumnInfo[];
  onAddFilter: (column: string) => void;
}

function SchemaView({ tableName, columns, onAddFilter }: SchemaViewProps) {
  return (
    <div className="flex-1 overflow-auto">
      <div className="px-3 py-3">
        <div className="text-sm">{tableName}</div>
        <div className="text-text-lighter text-xs">{columns.length} columns</div>
      </div>
      <div className="mx-3 mb-3 divide-y divide-border/60 rounded-xl bg-secondary-bg/40">
        {columns.map((c) => (
          <div
            key={c.name}
            className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-hover"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {getColumnIcon(c.type, c.primary_key)}
              <span className="truncate text-sm">{c.name}</span>
              <span className="text-text-lighter text-xs">{c.type}</span>
              {c.primary_key && <span className="text-text-lighter text-xs">PK</span>}
              {c.notnull && <span className="text-text-lighter text-xs">NN</span>}
              {c.default_value && (
                <span className="truncate text-text-lighter text-xs">def: {c.default_value}</span>
              )}
            </div>
            <button
              onClick={() => onAddFilter(c.name)}
              className="rounded-full border border-transparent px-2 py-1 text-text-lighter text-xs opacity-60 hover:border-border/70 hover:bg-hover hover:text-text hover:opacity-100"
            >
              <Filter size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

interface InfoViewProps {
  fileName: string;
  dbInfo: { tables: number; indexes: number; version: string } | null;
  tables: { name: string }[];
  selectedTable: string | null;
  columnFilters: ColumnFilter[];
  sqlHistory: string[];
  onSelectTable: (name: string) => void;
  onSelectHistory: (query: string) => void;
}

function InfoView({
  fileName,
  dbInfo,
  tables,
  selectedTable,
  columnFilters,
  sqlHistory,
  onSelectTable,
  onSelectHistory,
}: InfoViewProps) {
  return (
    <div className="flex-1 space-y-2 overflow-auto p-3">
      <div className="rounded-xl bg-secondary-bg/40 p-3">
        <div className="mb-1 text-sm">{fileName}</div>
        <div className="flex gap-4 text-text-lighter text-xs">
          <span>{dbInfo?.tables || 0} tables</span>
          <span>{dbInfo?.indexes || 0} indexes</span>
          <span>v{dbInfo?.version || "0"}</span>
          {selectedTable && <span>current: {selectedTable}</span>}
          {columnFilters.length > 0 && <span>{columnFilters.length} filters</span>}
        </div>
      </div>
      <div className="rounded-xl bg-secondary-bg/40 p-3">
        <div className="mb-2 text-text-lighter text-xs">tables</div>
        <div className="space-y-1">
          {tables.map((t) => (
            <button
              key={t.name}
              onClick={() => onSelectTable(t.name)}
              className={cn(
                "block w-full rounded-lg px-2 py-1 text-left text-xs hover:bg-hover",
                selectedTable === t.name && "bg-selected",
              )}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
      {sqlHistory.length > 0 && (
        <div className="rounded-xl bg-secondary-bg/40 p-3">
          <div className="mb-2 text-text-lighter text-xs">recent</div>
          <div className="max-h-32 space-y-1 overflow-y-auto">
            {sqlHistory.map((q, i) => (
              <button
                key={i}
                onClick={() => onSelectHistory(q)}
                className="block w-full truncate rounded-lg px-2 py-1 text-left text-xs hover:bg-hover"
                title={q}
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function Pagination({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <Dropdown
          value={pageSize.toString()}
          options={PAGE_SIZES}
          onChange={(v) => onPageSizeChange(Number(v))}
          size="xs"
          className="min-w-16"
        />
        <span className="text-text-lighter text-xs">per page</span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          className="px-2 py-1 text-text-lighter text-xs hover:text-text disabled:opacity-50"
        >
          ← Prev
        </button>
        <span className="px-2 text-xs">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          className="px-2 py-1 text-text-lighter text-xs hover:text-text disabled:opacity-50"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
