import { useEffect, useState } from "react";
import CreateSubscriptionDialog from "../postgres/components/create-subscription-dialog";
import PostgresSubscriptionSchemaView from "../postgres/components/postgres-subscription-schema-view";
import ColumnFilters from "../../components/column-filters";
import { SqlRowMenu, SqlTableMenu } from "../../components/context-menus";
import { CreateRowModal, CreateTableModal, EditRowModal } from "../../components/crud-modals";
import DataGrid from "../../components/data-grid";
import InfoView from "../../components/info-view";
import Pagination from "../../components/pagination";
import QueryBar from "../../components/query-bar";
import SchemaView from "../../components/schema-view";
import TableSidebar from "../../components/table-sidebar";
import TableToolbar from "../../components/table-toolbar";
import {
  buildQueryResultExportFilename,
  serializeQueryResultToCsv,
  serializeQueryResultToJson,
} from "../../lib/query-result-export";
import { paginateQueryResult } from "../../lib/query-result-pagination";
import { writeDatabaseClipboardText } from "../../utils/clipboard";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { LoadingIndicator } from "@/ui/loading";
import type { DatabaseObjectKind, ViewMode } from "../../models/common.types";
import type { DatabaseType } from "../../models/provider.types";
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
  const isCatalogOnlyObject = store.selectedObjectKind === "index";
  const canMutateRows = store.selectedObjectKind === "table" && !store.isCustomQuery;
  const isBusy = store.isLoading || store.isCustomQueryLoading;
  const visibleQueryResult =
    store.queryResult && store.isCustomQuery
      ? paginateQueryResult(store.queryResult, store.currentPage, store.pageSize)
      : store.queryResult;
  const gridResultLabel =
    store.isCustomQuery && store.totalPages > 1 ? "query rows on this page" : "query rows";

  useEffect(() => {
    if (initKey) actions.init(initKey);
    return () => actions.reset();
  }, [initKey, actions]);

  const handleTableContextMenu = (
    e: React.MouseEvent,
    tableName: string,
    objectKind: DatabaseObjectKind,
  ) => {
    e.preventDefault();
    setDatabaseTableMenu({
      x: e.clientX,
      y: e.clientY,
      tableName,
      objectKind,
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
    if (!pk) {
      await actions.deleteRowByValues(rowData);
      return;
    }
    const pkValue = rowData[pk.name];
    if (pkValue != null) {
      await actions.deleteRow(pk.name, pkValue);
      return;
    }
    await actions.deleteRowByValues(rowData);
  };

  const handleSubmitEditRow = async (values: Record<string, unknown>) => {
    if (!canMutateRows) return;
    const pk = store.tableMeta.find((c) => c.primary_key);
    if (!pk) {
      await actions.updateRowByValues(editRowModal.rowData, values);
      return;
    }
    const pkValue = editRowModal.rowData[pk.name];
    if (pkValue != null) {
      await actions.updateRow(pk.name, pkValue, values);
      return;
    }
    await actions.updateRowByValues(editRowModal.rowData, values);
  };

  const exportAsCSV = () => {
    if (!visibleQueryResult) return;
    const blob = new Blob([serializeQueryResultToCsv(visibleQueryResult)], {
      type: "text/csv;charset=utf-8;",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = buildQueryResultExportFilename({
      isCustomQuery: store.isCustomQuery,
      selectedTable: store.selectedTable,
      page: store.currentPage,
      totalPages: store.totalPages,
    });
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const copyAsJSON = async () => {
    if (!visibleQueryResult) return;
    await writeDatabaseClipboardText(serializeQueryResultToJson(visibleQueryResult));
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-secondary-bg text-text">
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
        resultRowCount={visibleQueryResult?.rows.length ?? 0}
        currentPage={store.currentPage}
        totalPages={store.totalPages}
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
            const objectKind = store.tables.find((table) => table.name === name)?.kind ?? "table";
            actions.selectTable(name);
            setViewMode(objectKind === "index" ? "info" : "data");
          }}
          onTableContextMenu={handleTableContextMenu}
          onCreateTable={() => setCreateTableModal(true)}
          sqlHistory={store.sqlHistory}
          onSelectHistory={(query) => {
            actions.useSqlHistoryEntry(query);
            actions.setCustomQuery(query);
            actions.setIsCustomQuery(true);
          }}
          onRunHistory={(query) => {
            actions.useSqlHistoryEntry(query);
            actions.setCustomQuery(query);
            actions.setIsCustomQuery(true);
            void actions.executeCustomQuery(query);
          }}
          onRemoveHistory={actions.removeSqlHistoryEntry}
          onClearHistory={actions.clearSqlHistory}
        />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-primary-bg">
          <QueryBar
            searchTerm={canMutateRows ? store.searchTerm : ""}
            setSearchTerm={actions.setSearchTerm}
            customQuery={store.customQuery}
            setCustomQuery={actions.setCustomQuery}
            isCustomQuery={store.isCustomQuery}
            setIsCustomQuery={actions.setIsCustomQuery}
            cancelCustomQuery={actions.cancelCustomQuery}
            executeCustomQuery={actions.executeCustomQuery}
            lastQueryExecutionMs={store.lastQueryExecutionMs}
            isLoading={isBusy}
            isCustomQueryLoading={store.isCustomQueryLoading}
            tables={store.tables}
            tableMeta={store.tableMeta}
          />

          {viewMode === "data" && canMutateRows && (
            <ColumnFilters
              filters={store.columnFilters}
              columns={store.tableMeta}
              onUpdate={actions.updateColumnFilter}
              onRemove={actions.removeColumnFilter}
              onClear={actions.clearFilters}
              onAddFilter={actions.addColumnFilter}
            />
          )}

          {store.error && (
            <div className="mx-3 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 ui-font ui-text-sm text-red-300">
              {store.error}
            </div>
          )}

          {isBusy && (
            <div className="flex flex-1 items-center justify-center p-8">
              <LoadingIndicator label="Loading" showLabel />
            </div>
          )}

          {!isBusy && viewMode === "data" && visibleQueryResult && (
            <DataGrid
              queryResult={visibleQueryResult}
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
              resultLabel={store.isCustomQuery ? gridResultLabel : "rows"}
              foreignKeys={store.foreignKeys}
              columnWidths={store.columnWidths}
              onColumnWidthChange={actions.setColumnWidth}
              onNavigateToForeignKey={actions.navigateToForeignKey}
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

          {!isBusy && viewMode === "schema" && isSubscription && store.subscriptionInfo && (
            <PostgresSubscriptionSchemaView subscriptionInfo={store.subscriptionInfo} />
          )}

          {!isBusy &&
            viewMode === "schema" &&
            !isSubscription &&
            !isCatalogOnlyObject &&
            store.selectedTable &&
            store.tableMeta.length > 0 && (
              <SchemaView
                tableName={store.selectedTable}
                columns={store.tableMeta}
                foreignKeys={store.foreignKeys}
                onAddFilter={actions.addColumnFilter}
                canFilter={canMutateRows}
              />
            )}

          {!isBusy && viewMode === "info" && (
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
                actions.useSqlHistoryEntry(query);
                actions.setCustomQuery(query);
                actions.setIsCustomQuery(true);
                setViewMode("data");
              }}
              onQueryRun={(query) => {
                actions.useSqlHistoryEntry(query);
                actions.setCustomQuery(query);
                actions.setIsCustomQuery(true);
                setViewMode("data");
                void actions.executeCustomQuery(query);
              }}
              onQueryRemove={actions.removeSqlHistoryEntry}
              onQueryHistoryClear={actions.clearSqlHistory}
            />
          )}

          {!isBusy &&
            viewMode === "data" &&
            store.queryResult &&
            (store.isCustomQuery || canMutateRows) &&
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

      <SqlTableMenu
        onCreateRow={(tableName) => setCreateRowModal({ isOpen: true, tableName })}
        onDeleteTable={actions.dropTable}
      />
      <SqlRowMenu onEditRow={handleEditRow} onDeleteRow={handleDeleteRow} />

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
