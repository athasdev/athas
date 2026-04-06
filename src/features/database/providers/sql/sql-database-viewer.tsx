import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import CreateSubscriptionDialog from "../postgres/components/create-subscription-dialog";
import PostgresSubscriptionSchemaView from "../postgres/components/postgres-subscription-schema-view";
import { useUIState } from "@/features/window/stores/ui-state-store";
import type { ViewMode } from "../../models/common.types";
import type { DatabaseType } from "../../models/provider.types";
import { SqliteRowMenu, SqliteTableMenu } from "../sqlite/components/context-menus";
import { CreateRowModal, CreateTableModal, EditRowModal } from "../sqlite/components/crud-modals";
import DataGrid from "../sqlite/components/data-grid";
import FilterBar from "../sqlite/components/filter-bar";
import InfoView from "../sqlite/components/info-view";
import PaginationControls from "../sqlite/components/pagination-controls";
import QueryBar from "../sqlite/components/query-bar";
import SchemaView from "../sqlite/components/schema-view";
import TableSidebar from "../sqlite/components/table-sidebar";
import TableToolbar from "../sqlite/components/table-toolbar";
import type { SqlDatabaseActions, SqlDatabaseState } from "./create-sql-store";

export interface SqlDatabaseViewerProps {
  databasePath?: string;
  connectionId?: string;
  databaseType: DatabaseType;
  useStore: () => SqlDatabaseState & { actions: SqlDatabaseActions };
}

export default function SqlDatabaseViewer({
  databasePath,
  connectionId,
  databaseType,
  useStore,
}: SqlDatabaseViewerProps) {
  const store = useStore();
  const { actions } = store;
  const { setDatabaseTableMenu, setDatabaseRowMenu } = useUIState();

  const [viewMode, setViewMode] = useState<ViewMode>("data");
  const [showColumnTypes, setShowColumnTypes] = useState(true);
  const [createRowModal, setCreateRowModal] = useState({
    isOpen: false,
    tableName: "",
  });
  const [editRowModal, setEditRowModal] = useState<{
    isOpen: boolean;
    tableName: string;
    rowData: Record<string, unknown>;
  }>({ isOpen: false, tableName: "", rowData: {} });
  const [createTableModal, setCreateTableModal] = useState(false);
  const [createSubscriptionModal, setCreateSubscriptionModal] = useState(false);

  const initKey = databasePath || connectionId || "";
  const isSubscription = store.selectedObjectKind === "subscription";
  const canMutateRows = store.selectedObjectKind === "table";

  useEffect(() => {
    if (initKey) actions.init(initKey);
    return () => actions.reset();
  }, [initKey, actions]);

  const handleTableContextMenu = (e: React.MouseEvent, tableName: string) => {
    e.preventDefault();
    setDatabaseTableMenu({
      x: e.clientX,
      y: e.clientY,
      tableName,
      databaseType,
    });
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
      databaseType,
    });
  };

  const handleEditRow = (tableName: string, rowData: Record<string, unknown>) => {
    setEditRowModal({ isOpen: true, tableName, rowData });
  };

  const handleDeleteRow = async (_: string, rowData: Record<string, unknown>) => {
    if (!canMutateRows) return;
    const pk = store.tableMeta.find((c) => c.primary_key);
    if (!pk) return;
    const pkValue = rowData[pk.name];
    if (pkValue != null) await actions.deleteRow(pk.name, pkValue);
  };

  const handleSubmitEditRow = async (values: Record<string, unknown>) => {
    if (!canMutateRows) return;
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
    const blob = new Blob([`${headers}\n${rows}`], {
      type: "text/csv;charset=utf-8;",
    });
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
        selectedObjectKind={store.selectedObjectKind}
        subscriptionInfo={store.subscriptionInfo}
        viewMode={viewMode}
        setViewMode={setViewMode}
        isCustomQuery={store.isCustomQuery}
        showColumnTypes={showColumnTypes}
        setShowColumnTypes={setShowColumnTypes}
        setIsCustomQuery={actions.setIsCustomQuery}
        hasData={!!store.queryResult}
        exportAsCSV={exportAsCSV}
        copyAsJSON={copyAsJSON}
        onCreateSubscription={
          databaseType === "postgres" ? () => setCreateSubscriptionModal(true) : undefined
        }
        onToggleSubscription={
          isSubscription && store.selectedTable && store.subscriptionInfo
            ? () =>
                void actions.setSubscriptionEnabled(
                  store.selectedTable!,
                  !store.subscriptionInfo!.enabled,
                )
            : undefined
        }
        onRefreshSubscription={
          isSubscription && store.selectedTable
            ? () => void actions.refreshSubscription(store.selectedTable!, false)
            : undefined
        }
        onDropSubscription={
          isSubscription && store.selectedTable
            ? () => void actions.dropSubscription(store.selectedTable!, true)
            : undefined
        }
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
            searchTerm={canMutateRows ? store.searchTerm : ""}
            setSearchTerm={actions.setSearchTerm}
            customQuery={store.customQuery}
            setCustomQuery={actions.setCustomQuery}
            isCustomQuery={store.isCustomQuery}
            setIsCustomQuery={actions.setIsCustomQuery}
            executeCustomQuery={actions.executeCustomQuery}
            isLoading={store.isLoading}
          />

          {viewMode === "data" && canMutateRows && (
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
                <RefreshCw className="animate-spin" />
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
              canSortColumns={canMutateRows}
              canFilterColumns={canMutateRows}
              canEditCells={canMutateRows}
              canCreateRows={canMutateRows}
              canOpenRowMenu={canMutateRows}
              onCreateRow={() =>
                canMutateRows &&
                store.selectedTable &&
                setCreateRowModal({
                  isOpen: true,
                  tableName: store.selectedTable,
                })
              }
            />
          )}

          {!store.isLoading &&
            viewMode === "schema" &&
            isSubscription &&
            store.subscriptionInfo && (
              <PostgresSubscriptionSchemaView subscriptionInfo={store.subscriptionInfo} />
            )}

          {!store.isLoading &&
            viewMode === "schema" &&
            !isSubscription &&
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
              selectedTable={store.selectedTable}
              columnFilters={store.columnFilters}
              tables={store.tables}
              sqlHistory={store.sqlHistory}
              onTableChange={(name) => {
                actions.selectTable(name);
                setViewMode("data");
              }}
              onQuerySelect={(query) => {
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
            canMutateRows &&
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

      <CreateSubscriptionDialog
        isOpen={createSubscriptionModal}
        onClose={() => setCreateSubscriptionModal(false)}
        onSubmit={actions.createSubscription}
      />
    </div>
  );
}
