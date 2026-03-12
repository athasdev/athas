import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useUIState } from "@/stores/ui-state-store";
import type { ViewMode } from "../../models/common.types";
import { SqliteRowMenu, SqliteTableMenu } from "./components/context-menus";
import { CreateRowModal, CreateTableModal, EditRowModal } from "./components/crud-modals";
import DataGrid from "./components/data-grid";
import FilterBar from "./components/filter-bar";
import PaginationControls from "./components/pagination-controls";
import QueryBar from "./components/query-bar";
import SchemaView from "./components/schema-view";
import TableSidebar from "./components/table-sidebar";
import TableToolbar from "./components/table-toolbar";
import { useSqliteStore } from "./stores/sqlite-store";

export interface SQLiteViewerProps {
  databasePath: string;
}

export default function SQLiteViewer({ databasePath }: SQLiteViewerProps) {
  const store = useSqliteStore();
  const { actions } = store;
  const { setDatabaseTableMenu, setDatabaseRowMenu } = useUIState();

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
    setDatabaseTableMenu({ x: e.clientX, y: e.clientY, tableName, databaseType: "sqlite" });
  };

  const handleRowContextMenu = (e: React.MouseEvent, rowIndex: number) => {
    e.preventDefault();
    if (!store.queryResult) return;
    const row = store.queryResult.rows[rowIndex];
    const rowData: Record<string, unknown> = {};
    store.queryResult.columns.forEach((col, i) => {
      rowData[col] = row[i];
    });
    setDatabaseRowMenu({
      x: e.clientX,
      y: e.clientY,
      tableName: store.selectedTable || "",
      rowData,
      databaseType: "sqlite",
    });
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
      <TableToolbar
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
        <TableSidebar
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

          {viewMode === "data" && (
            <FilterBar
              filters={store.columnFilters}
              columns={store.tableMeta}
              onUpdate={actions.updateColumnFilter}
              onRemove={actions.removeColumnFilter}
              onClear={actions.clearFilters}
              onAddFilter={actions.addColumnFilter}
            />
          )}

          {store.error && (
            <div className="mx-3 mb-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-red-300 text-xs">
              {store.error}
            </div>
          )}

          {store.isLoading && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="flex items-center gap-2 text-sm text-text-lighter">
                <RefreshCw size={16} className="animate-spin" />
                Loading...
              </div>
            </div>
          )}

          {!store.isLoading && viewMode === "data" && store.queryResult && (
            <DataGrid
              queryResult={store.queryResult}
              tableMeta={store.tableMeta}
              tableName={store.selectedTable}
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
                foreignKeys={store.foreignKeys}
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
              <PaginationControls
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

// Keep InfoView inline since it's simple and only used here
interface InfoViewProps {
  fileName: string;
  dbInfo: { tables: number; indexes: number; version: string } | null;
  tables: { name: string }[];
  selectedTable: string | null;
  columnFilters: { column: string }[];
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
              className={`block w-full rounded-lg px-2 py-1 text-left text-xs hover:bg-hover ${
                selectedTable === t.name ? "bg-selected" : ""
              }`}
              aria-label={`View table ${t.name}`}
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
