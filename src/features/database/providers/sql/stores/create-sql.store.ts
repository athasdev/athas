import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
import { formatDatabaseError } from "../../../lib/database-errors";
import { getQueryResultTotalPages } from "../../../lib/query-result-pagination";
import {
  addSqlHistoryEntry,
  removeSqlHistoryEntry,
  useSqlHistoryEntry,
} from "../../../lib/sql-history";
import { loadSqlHistory, saveSqlHistory } from "../../../lib/sql-history-storage";
import type {
  ColumnFilter,
  ColumnInfo,
  CreatePostgresSubscriptionParams,
  DatabaseObjectKind,
  DatabaseInfo,
  FilteredQueryResult,
  ForeignKeyInfo,
  PostgresSubscriptionInfo,
  QueryResult,
  TableInfo,
} from "../../../types/common.types";
import type { DatabaseType } from "../../../types/provider.types";

export interface SqlDatabaseState {
  databasePath: string | null;
  connectionId: string | null;
  fileName: string;
  tables: TableInfo[];
  selectedTable: string | null;
  selectedObjectKind: DatabaseObjectKind;
  queryResult: QueryResult | null;
  tableMeta: ColumnInfo[];
  foreignKeys: ForeignKeyInfo[];
  subscriptionInfo: PostgresSubscriptionInfo | null;
  dbInfo: DatabaseInfo | null;
  error: string | null;
  isLoading: boolean;
  isCustomQueryLoading: boolean;

  currentPage: number;
  pageSize: number;
  totalPages: number;

  searchTerm: string;
  columnFilters: ColumnFilter[];
  sortColumn: string | null;
  sortDirection: "asc" | "desc";

  customQuery: string;
  isCustomQuery: boolean;
  lastQueryExecutionMs: number | null;
  sqlHistory: string[];

  columnWidths: Record<string, Record<string, number>>;
}

export interface SqlDatabaseActions {
  init: (pathOrConnectionId: string) => Promise<void>;
  reset: () => void;
  selectTable: (tableName: string) => Promise<void>;
  refresh: () => Promise<void>;

  setSearchTerm: (term: string) => void;
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;

  addColumnFilter: (column: string) => void;
  updateColumnFilter: (index: number, updates: Partial<ColumnFilter>) => void;
  removeColumnFilter: (index: number) => void;
  clearFilters: () => void;

  toggleSort: (column: string) => void;

  setCustomQuery: (query: string) => void;
  setIsCustomQuery: (is: boolean) => void;
  cancelCustomQuery: () => void;
  executeCustomQuery: (queryOverride?: string) => Promise<void>;
  useSqlHistoryEntry: (query: string) => void;
  removeSqlHistoryEntry: (query: string) => void;
  clearSqlHistory: () => void;

  insertRow: (values: Record<string, unknown>) => Promise<void>;
  updateRow: (pkColumn: string, pkValue: unknown, values: Record<string, unknown>) => Promise<void>;
  updateRowByValues: (
    rowData: Record<string, unknown>,
    values: Record<string, unknown>,
  ) => Promise<void>;
  deleteRow: (pkColumn: string, pkValue: unknown) => Promise<void>;
  deleteRowByValues: (rowData: Record<string, unknown>) => Promise<void>;
  updateCell: (rowIndex: number, columnName: string, newValue: unknown) => Promise<void>;
  createTable: (
    name: string,
    columns: { name: string; type: string; notnull: boolean }[],
  ) => Promise<void>;
  dropTable: (name: string) => Promise<void>;
  createSubscription: (params: CreatePostgresSubscriptionParams) => Promise<void>;
  dropSubscription: (name: string, withDropSlot: boolean) => Promise<void>;
  setSubscriptionEnabled: (name: string, enabled: boolean) => Promise<void>;
  refreshSubscription: (name: string, copyData: boolean) => Promise<void>;

  setColumnWidth: (table: string, column: string, width: number) => void;
  navigateToForeignKey: (toTable: string, toColumn: string, value: unknown) => Promise<void>;
}

type ConnectionMode = "file" | "connection";

interface CommandMap {
  getTables: string;
  query: string;
  queryFiltered: string;
  execute: string;
  insertRow: string;
  updateRow: string;
  updateRowByValues: string;
  deleteRow: string;
  deleteRowByValues: string;
  getForeignKeys: string;
}

interface RowIdentity {
  columns: string[];
  values: unknown[];
}

export const POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS = {
  getInfo: "get_postgres_subscription_info",
  getStatus: "get_postgres_subscription_status",
  create: "create_postgres_subscription",
  drop: "drop_postgres_subscription",
  setEnabled: "set_postgres_subscription_enabled",
  refresh: "refresh_postgres_subscription",
} as const;

export function getSqlProviderCommandMap(dbType: DatabaseType): CommandMap {
  return {
    getTables: `get_${dbType}_tables`,
    query: `query_${dbType}`,
    queryFiltered: `query_${dbType}_filtered`,
    execute: `execute_${dbType}`,
    insertRow: `insert_${dbType}_row`,
    updateRow: `update_${dbType}_row`,
    updateRowByValues: `update_${dbType}_row_by_values`,
    deleteRow: `delete_${dbType}_row`,
    deleteRowByValues: `delete_${dbType}_row_by_values`,
    getForeignKeys: `get_${dbType}_foreign_keys`,
  };
}

export function getSqlTableSchemaCommand(dbType: DatabaseType): string | null {
  return dbType === "postgres" || dbType === "mysql" ? `get_${dbType}_table_schema` : null;
}

function getConnectionArg(mode: ConnectionMode, pathOrId: string) {
  return mode === "file" ? { path: pathOrId } : { connectionId: pathOrId };
}

function getActiveConnectionKey(mode: ConnectionMode, state: SqlDatabaseState): string | null {
  return mode === "file" ? state.databasePath : state.connectionId;
}

function persistSqlHistory(
  dbType: DatabaseType,
  mode: ConnectionMode,
  state: SqlDatabaseState,
  history: string[],
): void {
  const connKey = getActiveConnectionKey(mode, state);
  if (!connKey) return;
  saveSqlHistory(dbType, mode, connKey, history);
}

function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.max(1, Math.min(Math.trunc(page), Math.max(1, totalPages)));
}

function normalizePageSize(size: number): number {
  if (!Number.isFinite(size)) return 50;
  return Math.max(1, Math.min(Math.trunc(size), 500));
}

function normalizeColumnFilterUpdate(
  filter: ColumnFilter,
  updates: Partial<ColumnFilter>,
): ColumnFilter {
  const nextFilter = { ...filter, ...updates };
  if (nextFilter.operator === "isNull" || nextFilter.operator === "isNotNull") {
    return { ...nextFilter, value: "", value2: undefined };
  }
  if (nextFilter.operator !== "between") {
    return { ...nextFilter, value2: undefined };
  }
  return nextFilter;
}

function isSameConnectionContext(
  mode: ConnectionMode,
  state: SqlDatabaseState,
  connKey: string,
): boolean {
  return getActiveConnectionKey(mode, state) === connKey;
}

function isSameTableMutationContext(
  mode: ConnectionMode,
  state: SqlDatabaseState,
  connKey: string,
  tableName: string,
): boolean {
  return (
    getActiveConnectionKey(mode, state) === connKey &&
    state.selectedTable === tableName &&
    state.selectedObjectKind === "table"
  );
}

function buildRowIdentity(columns: string[], row: unknown[]): RowIdentity {
  return { columns, values: row };
}

function normalizeQueryResult(value: unknown): QueryResult {
  if (!value || typeof value !== "object") return { columns: [], rows: [] };

  const result = value as { columns?: unknown; rows?: unknown };
  const columns = Array.isArray(result.columns)
    ? result.columns.filter((column): column is string => typeof column === "string")
    : [];
  const rows = Array.isArray(result.rows)
    ? result.rows.filter((row): row is unknown[] => Array.isArray(row))
    : [];

  return { columns, rows };
}

const initialState: SqlDatabaseState = {
  databasePath: null,
  connectionId: null,
  fileName: "",
  tables: [],
  selectedTable: null,
  selectedObjectKind: "table",
  queryResult: null,
  tableMeta: [],
  foreignKeys: [],
  subscriptionInfo: null,
  dbInfo: null,
  error: null,
  isLoading: false,
  isCustomQueryLoading: false,
  currentPage: 1,
  pageSize: 50,
  totalPages: 1,
  searchTerm: "",
  columnFilters: [],
  sortColumn: null,
  sortDirection: "asc",
  customQuery: "",
  isCustomQuery: false,
  lastQueryExecutionMs: null,
  sqlHistory: [],
  columnWidths: {},
};

function getClearedSelectionState(): Pick<
  SqlDatabaseState,
  | "selectedTable"
  | "selectedObjectKind"
  | "queryResult"
  | "tableMeta"
  | "foreignKeys"
  | "subscriptionInfo"
  | "isCustomQueryLoading"
  | "currentPage"
  | "totalPages"
  | "searchTerm"
  | "columnFilters"
  | "sortColumn"
  | "sortDirection"
  | "isCustomQuery"
  | "lastQueryExecutionMs"
> {
  return {
    selectedTable: null,
    selectedObjectKind: "table",
    queryResult: null,
    tableMeta: [],
    foreignKeys: [],
    subscriptionInfo: null,
    isCustomQueryLoading: false,
    currentPage: 1,
    totalPages: 1,
    searchTerm: "",
    columnFilters: [],
    sortColumn: null,
    sortDirection: "asc",
    isCustomQuery: false,
    lastQueryExecutionMs: null,
  };
}

function getObjectKind(objects: TableInfo[], name: string | null | undefined): DatabaseObjectKind {
  if (!name) return "table";
  return objects.find((object) => object.name === name)?.kind ?? "table";
}

function getObjectInfo(objects: TableInfo[], name: string | null | undefined): TableInfo | null {
  if (!name) return null;
  return objects.find((object) => object.name === name) ?? null;
}

function quoteIdentifier(dbType: DatabaseType, name: string) {
  if (dbType === "mysql") {
    return `\`${name.replace(/`/g, "``")}\``;
  }

  return `"${name.replace(/"/g, '""')}"`;
}

function buildDropObjectStatement(dbType: DatabaseType, object: TableInfo, fallbackName: string) {
  const objectKind = object.kind ?? "table";
  if (objectKind === "index" && dbType === "mysql") {
    const tableName = object.table_name ?? object.tableName;
    if (!tableName) {
      throw new Error("MySQL index metadata is missing the table name");
    }
    return `DROP INDEX ${quoteIdentifier(dbType, object.name)} ON ${quoteIdentifier(dbType, tableName)}`;
  }

  const dropKeyword =
    objectKind === "materialized_view"
      ? "MATERIALIZED VIEW"
      : objectKind === "view"
        ? "VIEW"
        : objectKind === "index"
          ? "INDEX"
          : "TABLE";
  return `DROP ${dropKeyword} ${quoteIdentifier(dbType, fallbackName)}`;
}

export function createSqlStore(dbType: DatabaseType, mode: ConnectionMode) {
  const cmds = getSqlProviderCommandMap(dbType);
  let initRequestId = 0;
  let selectTableRequestId = 0;
  let refreshRequestId = 0;
  let customQueryRequestId = 0;

  const useStoreBase = create<SqlDatabaseState & { actions: SqlDatabaseActions }>()(
    immer((set, get) => ({
      ...initialState,

      actions: {
        init: async (pathOrConnectionId: string) => {
          const requestId = ++initRequestId;
          selectTableRequestId += 1;
          refreshRequestId += 1;
          customQueryRequestId += 1;
          const fileName =
            mode === "file"
              ? pathOrConnectionId.split("/").pop() ||
                pathOrConnectionId.split("\\").pop() ||
                "Database"
              : pathOrConnectionId;

          const connState =
            mode === "file"
              ? { databasePath: pathOrConnectionId }
              : { connectionId: pathOrConnectionId };

          set({
            ...initialState,
            ...connState,
            fileName,
            sqlHistory: loadSqlHistory(dbType, mode, pathOrConnectionId),
            isLoading: true,
            error: null,
          });

          try {
            const connArg = getConnectionArg(mode, pathOrConnectionId);
            const tables = (await invokeDatabaseProvider(cmds.getTables, connArg)) as TableInfo[];
            if (requestId !== initRequestId) return;
            set({ tables });

            if (tables.length > 0) {
              const initialObject =
                tables.find((table) => (table.kind ?? "table") === "table") ?? tables[0];
              await get().actions.selectTable(initialObject.name);
            }

            // Try to get database info
            try {
              if (dbType === "sqlite" || dbType === "duckdb") {
                const versionQuery =
                  dbType === "sqlite" ? "PRAGMA user_version;" : "PRAGMA version;";
                const versionResult = (await invokeDatabaseProvider(cmds.query, {
                  ...connArg,
                  query: versionQuery,
                })) as QueryResult;

                const indexQuery =
                  dbType === "sqlite"
                    ? "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';"
                    : "SELECT COUNT(*) FROM duckdb_indexes();";
                const indexResult = (await invokeDatabaseProvider(cmds.query, {
                  ...connArg,
                  query: indexQuery,
                })) as QueryResult;

                if (requestId !== initRequestId) return;

                set({
                  dbInfo: {
                    version: versionResult.rows[0]?.[0]?.toString() || "0",
                    size: 0,
                    tables: tables.length,
                    indexes: Number(indexResult.rows[0]?.[0]) || 0,
                  },
                });
              } else {
                if (requestId !== initRequestId) return;

                set({
                  dbInfo: {
                    version: "",
                    size: 0,
                    tables: tables.length,
                    indexes: 0,
                  },
                });
              }
            } catch {
              // Ignore db info errors
            }
          } catch (err) {
            if (requestId !== initRequestId) return;
            set({ error: formatDatabaseError("Failed to load database", err) });
          } finally {
            if (requestId === initRequestId) {
              set({ isLoading: false });
            }
          }
        },

        reset: () => {
          initRequestId += 1;
          selectTableRequestId += 1;
          refreshRequestId += 1;
          customQueryRequestId += 1;
          set(initialState);
        },

        selectTable: async (tableName: string) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey) return;
          const selectedObjectKind = getObjectKind(state.tables, tableName);
          const requestId = ++selectTableRequestId;

          refreshRequestId += 1;

          set({
            selectedTable: tableName,
            selectedObjectKind,
            currentPage: 1,
            searchTerm: "",
            isCustomQuery: false,
            columnFilters: [],
            sortColumn: null,
            queryResult: null,
            tableMeta: [],
            foreignKeys: [],
            subscriptionInfo: null,
            isLoading: true,
            isCustomQueryLoading: false,
          });

          try {
            const connArg = getConnectionArg(mode, connKey);

            if (selectedObjectKind === "subscription" && dbType === "postgres") {
              const [subscriptionInfo, queryResult] = await Promise.all([
                invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getInfo, {
                  ...connArg,
                  subscription: tableName,
                }) as Promise<PostgresSubscriptionInfo>,
                invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getStatus, {
                  ...connArg,
                  subscription: tableName,
                }) as Promise<QueryResult>,
              ]);

              if (requestId !== selectTableRequestId) return;

              const tableMeta: ColumnInfo[] = queryResult.columns.map((column) => ({
                name: column,
                type: "text",
                notnull: false,
                default_value: null,
                primary_key: column === "relation",
              }));

              set({
                subscriptionInfo,
                queryResult,
                tableMeta,
                foreignKeys: [],
                totalPages: 1,
              });
              return;
            }

            if (selectedObjectKind === "index") {
              set({
                tableMeta: [],
                foreignKeys: [],
                queryResult: null,
                totalPages: 1,
              });
              return;
            }

            // Get table schema - provider-specific PRAGMA or information_schema
            let tableMeta: ColumnInfo[];
            if (dbType === "sqlite" || dbType === "duckdb") {
              const result = (await invokeDatabaseProvider(cmds.query, {
                ...connArg,
                query: `PRAGMA table_info("${tableName.replace(/"/g, '""')}")`,
              })) as QueryResult;

              tableMeta = result.rows.map((row) => ({
                name: row[1] as string,
                type: row[2] as string,
                notnull: Boolean(row[3]),
                default_value: row[4] as string | null,
                primary_key: Boolean(row[5]),
              }));
            } else {
              // For postgres/mysql, the get_tables command returns column info via a dedicated command
              const tableSchemaCommand = getSqlTableSchemaCommand(dbType);
              if (!tableSchemaCommand) {
                throw new Error(`Unsupported table schema command for ${dbType}`);
              }
              const result = (await invokeDatabaseProvider(tableSchemaCommand, {
                ...connArg,
                table: tableName,
              })) as ColumnInfo[];
              tableMeta = result;
            }

            if (requestId !== selectTableRequestId) return;

            set({ tableMeta });

            // Load foreign keys
            try {
              const foreignKeys = (await invokeDatabaseProvider(cmds.getForeignKeys, {
                ...connArg,
                table: tableName,
              })) as ForeignKeyInfo[];
              if (requestId !== selectTableRequestId) return;
              set({ foreignKeys });
            } catch {
              if (requestId !== selectTableRequestId) return;
              set({ foreignKeys: [] });
            }

            if (requestId !== selectTableRequestId) return;
            await get().actions.refresh();
          } catch (err) {
            if (requestId !== selectTableRequestId) return;
            set({ error: formatDatabaseError("Failed to load table", err) });
          } finally {
            if (requestId === selectTableRequestId) {
              set({ isLoading: false });
            }
          }
        },

        refresh: async () => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.selectedTable || state.isCustomQuery) return;
          if (state.selectedObjectKind === "index") return;
          const requestId = ++refreshRequestId;

          set({ isLoading: true, error: null });

          try {
            const connArg = getConnectionArg(mode, connKey);

            if (state.selectedObjectKind === "subscription" && dbType === "postgres") {
              const [subscriptionInfo, queryResult] = await Promise.all([
                invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getInfo, {
                  ...connArg,
                  subscription: state.selectedTable,
                }) as Promise<PostgresSubscriptionInfo>,
                invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getStatus, {
                  ...connArg,
                  subscription: state.selectedTable,
                }) as Promise<QueryResult>,
              ]);

              if (requestId !== refreshRequestId) return;

              set({
                subscriptionInfo,
                queryResult,
                tableMeta: queryResult.columns.map((column) => ({
                  name: column,
                  type: "text",
                  notnull: false,
                  default_value: null,
                  primary_key: column === "relation",
                })),
                totalPages: 1,
              });
              return;
            }

            const offset = (state.currentPage - 1) * state.pageSize;
            const searchTerm = state.searchTerm.trim();
            const searchColumns =
              state.tableMeta.length > 0
                ? state.tableMeta.map((column) => column.name)
                : (state.queryResult?.columns ?? []);

            const result = (await invokeDatabaseProvider(cmds.queryFiltered, {
              ...connArg,
              params: {
                table: state.selectedTable,
                filters: state.columnFilters.map((f) => ({
                  column: f.column,
                  operator: f.operator,
                  value: f.value,
                  value2: f.value2 ?? null,
                })),
                search_term: searchTerm || null,
                search_columns: searchTerm ? searchColumns : [],
                sort_column: state.sortColumn ?? null,
                sort_direction: state.sortDirection.toUpperCase(),
                page_size: state.pageSize,
                offset,
              },
            })) as FilteredQueryResult;

            const totalPages = Math.max(1, Math.ceil(result.total_count / state.pageSize));

            if (requestId !== refreshRequestId) return;

            set({
              queryResult: { columns: result.columns, rows: result.rows },
              totalPages,
            });
          } catch (err) {
            if (requestId !== refreshRequestId) return;
            set({ error: formatDatabaseError("Query failed", err) });
          } finally {
            if (requestId === refreshRequestId) {
              set({ isLoading: false });
            }
          }
        },

        setSearchTerm: (term: string) => {
          if (get().selectedObjectKind !== "table") return;
          set({ searchTerm: term, currentPage: 1 });
          get().actions.refresh();
        },

        setCurrentPage: (page: number) => {
          const state = get();
          if (state.isCustomQuery) {
            set({ currentPage: clampPage(page, state.totalPages), error: null });
            return;
          }
          if (state.selectedObjectKind !== "table") return;
          set({ currentPage: clampPage(page, state.totalPages) });
          get().actions.refresh();
        },

        setPageSize: (size: number) => {
          const state = get();
          const pageSize = normalizePageSize(size);
          if (state.isCustomQuery) {
            set({
              pageSize,
              currentPage: 1,
              totalPages: getQueryResultTotalPages(state.queryResult, pageSize),
              error: null,
            });
            return;
          }
          if (state.selectedObjectKind !== "table") return;
          set({ pageSize, currentPage: 1 });
          get().actions.refresh();
        },

        addColumnFilter: (column: string) => {
          if (get().selectedObjectKind !== "table") return;
          set((s) => {
            s.columnFilters.push({ column, operator: "contains", value: "" });
          });
        },

        updateColumnFilter: (index: number, updates: Partial<ColumnFilter>) => {
          const state = get();
          if (
            state.selectedObjectKind !== "table" ||
            index < 0 ||
            index >= state.columnFilters.length
          )
            return;
          set((s) => {
            s.columnFilters[index] = normalizeColumnFilterUpdate(s.columnFilters[index], updates);
            s.currentPage = 1;
          });
          get().actions.refresh();
        },

        removeColumnFilter: (index: number) => {
          const state = get();
          if (
            state.selectedObjectKind !== "table" ||
            index < 0 ||
            index >= state.columnFilters.length
          )
            return;
          set((s) => {
            s.columnFilters.splice(index, 1);
            s.currentPage = 1;
          });
          get().actions.refresh();
        },

        clearFilters: () => {
          if (get().selectedObjectKind !== "table") return;
          set({ columnFilters: [], currentPage: 1 });
          get().actions.refresh();
        },

        toggleSort: (column: string) => {
          if (get().selectedObjectKind !== "table") return;
          set((s) => {
            if (s.sortColumn === column) {
              s.sortDirection = s.sortDirection === "asc" ? "desc" : "asc";
            } else {
              s.sortColumn = column;
              s.sortDirection = "asc";
            }
            s.currentPage = 1;
          });
          get().actions.refresh();
        },

        setCustomQuery: (query: string) => set({ customQuery: query }),
        setIsCustomQuery: (is: boolean) => {
          const wasCustomQuery = get().isCustomQuery;
          customQueryRequestId += 1;
          if (is) {
            refreshRequestId += 1;
          }
          set((s) => {
            s.isCustomQuery = is;
            s.isCustomQueryLoading = false;
            s.isLoading = is ? false : s.isLoading;
            s.error = null;

            if (is) {
              s.currentPage = 1;
              s.totalPages = getQueryResultTotalPages(s.queryResult, s.pageSize);
              s.searchTerm = "";
              s.columnFilters = [];
              s.sortColumn = null;
              s.sortDirection = "asc";
            }
          });
          if (wasCustomQuery && !is) {
            void get().actions.refresh();
          }
        },

        cancelCustomQuery: () => {
          customQueryRequestId += 1;
          set({ isCustomQueryLoading: false });
        },

        executeCustomQuery: async (queryOverride?: string) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          const query = (queryOverride ?? state.customQuery).trim();
          if (!connKey || !query) return;

          const requestId = ++customQueryRequestId;
          refreshRequestId += 1;
          const startedAt = performance.now();
          set({
            isCustomQueryLoading: true,
            isLoading: false,
            error: null,
            isCustomQuery: true,
            lastQueryExecutionMs: null,
          });

          try {
            const connArg = getConnectionArg(mode, connKey);
            const queryResult = normalizeQueryResult(
              await invokeDatabaseProvider(cmds.query, {
                ...connArg,
                query,
              }),
            );

            if (requestId !== customQueryRequestId) return;

            const newHistory = addSqlHistoryEntry(get().sqlHistory, query);
            persistSqlHistory(dbType, mode, get(), newHistory);

            set({
              queryResult,
              sqlHistory: newHistory,
              currentPage: 1,
              totalPages: getQueryResultTotalPages(queryResult, get().pageSize),
              lastQueryExecutionMs: Math.round(performance.now() - startedAt),
            });
          } catch (err) {
            if (requestId !== customQueryRequestId) return;
            set({ error: formatDatabaseError("Query error", err) });
          } finally {
            if (requestId === customQueryRequestId) {
              set({ isCustomQueryLoading: false });
            }
          }
        },

        removeSqlHistoryEntry: (query: string) => {
          const newHistory = removeSqlHistoryEntry(get().sqlHistory, query);
          persistSqlHistory(dbType, mode, get(), newHistory);
          set({ sqlHistory: newHistory });
        },

        useSqlHistoryEntry: (query: string) => {
          const newHistory = useSqlHistoryEntry(get().sqlHistory, query);
          persistSqlHistory(dbType, mode, get(), newHistory);
          set({ sqlHistory: newHistory });
        },

        clearSqlHistory: () => {
          persistSqlHistory(dbType, mode, get(), []);
          set({ sqlHistory: [] });
        },

        insertRow: async (values: Record<string, unknown>) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;
          const tableName = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.insertRow, {
              ...connArg,
              table: tableName,
              columns: Object.keys(values),
              values: Object.values(values),
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Insert failed", err), isLoading: false });
          }
        },

        updateRow: async (pkColumn: string, pkValue: unknown, values: Record<string, unknown>) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;
          const tableName = state.selectedTable;

          const { [pkColumn]: _, ...updateValues } = values;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.updateRow, {
              ...connArg,
              table: tableName,
              setColumns: Object.keys(updateValues),
              setValues: Object.values(updateValues),
              whereColumn: pkColumn,
              whereValue: pkValue,
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Update failed", err), isLoading: false });
          }
        },

        updateRowByValues: async (
          rowData: Record<string, unknown>,
          values: Record<string, unknown>,
        ) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;
          const tableName = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.updateRowByValues, {
              ...connArg,
              table: tableName,
              setColumns: Object.keys(values),
              setValues: Object.values(values),
              identity: {
                columns: Object.keys(rowData),
                values: Object.values(rowData),
              },
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Update failed", err), isLoading: false });
          }
        },

        deleteRow: async (pkColumn: string, pkValue: unknown) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;
          const tableName = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.deleteRow, {
              ...connArg,
              table: tableName,
              whereColumn: pkColumn,
              whereValue: pkValue,
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Delete failed", err), isLoading: false });
          }
        },

        deleteRowByValues: async (rowData: Record<string, unknown>) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;
          const tableName = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.deleteRowByValues, {
              ...connArg,
              table: tableName,
              identity: {
                columns: Object.keys(rowData),
                values: Object.values(rowData),
              },
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Delete failed", err), isLoading: false });
          }
        },

        updateCell: async (rowIndex: number, columnName: string, newValue: unknown) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (
            !connKey ||
            !state.selectedTable ||
            !state.queryResult ||
            state.selectedObjectKind !== "table"
          )
            return;

          const row = state.queryResult.rows[rowIndex];
          const pkColumn = state.tableMeta.find((c) => c.primary_key);
          const tableName = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            const pkIndex = pkColumn ? state.queryResult.columns.indexOf(pkColumn.name) : -1;
            const pkValue = pkIndex >= 0 ? row[pkIndex] : undefined;

            if (!pkColumn || pkValue === undefined || pkValue === null) {
              await invokeDatabaseProvider(cmds.updateRowByValues, {
                ...connArg,
                table: tableName,
                setColumns: [columnName],
                setValues: [newValue],
                identity: buildRowIdentity(state.queryResult.columns, row),
              });
              if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
              set({ error: null });
              await get().actions.refresh();
              return;
            }

            await invokeDatabaseProvider(cmds.updateRow, {
              ...connArg,
              table: tableName,
              setColumns: [columnName],
              setValues: [newValue],
              whereColumn: pkColumn.name,
              whereValue: pkValue,
            });
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            if (!isSameTableMutationContext(mode, get(), connKey, tableName)) return;
            set({ error: formatDatabaseError("Cell update failed", err), isLoading: false });
          }
        },

        createTable: async (
          name: string,
          columns: { name: string; type: string; notnull: boolean }[],
        ) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey) return;
          const selectedTableAtStart = state.selectedTable;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            const columnDefs = columns
              .map(
                (c) => `"${c.name.replace(/"/g, '""')}" ${c.type}${c.notnull ? " NOT NULL" : ""}`,
              )
              .join(", ");

            await invokeDatabaseProvider(cmds.execute, {
              ...connArg,
              statement: `CREATE TABLE "${name.replace(/"/g, '""')}" (${columnDefs})`,
            });

            if (!isSameConnectionContext(mode, get(), connKey)) return;
            const tables = (await invokeDatabaseProvider(cmds.getTables, connArg)) as TableInfo[];
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ tables, error: null });
            if (get().selectedTable === selectedTableAtStart) {
              await get().actions.selectTable(name);
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ error: formatDatabaseError("Create table failed", err), isLoading: false });
          }
        },

        dropTable: async (name: string) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey) return;
          const object = getObjectInfo(state.tables, name) ?? { name, kind: "table" };
          const objectKind = object.kind ?? "table";

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(cmds.execute, {
              ...connArg,
              statement: buildDropObjectStatement(dbType, object, name),
            });

            if (!isSameConnectionContext(mode, get(), connKey)) return;
            const tables = (await invokeDatabaseProvider(cmds.getTables, connArg)) as TableInfo[];
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ tables, error: null });

            if (get().selectedTable === name) {
              if (tables.length > 0) {
                const nextObject =
                  tables.find((table) => (table.kind ?? "table") === "table") ?? tables[0];
                await get().actions.selectTable(nextObject.name);
              } else {
                set({
                  ...getClearedSelectionState(),
                  isLoading: false,
                });
              }
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({
              error: formatDatabaseError(
                objectKind === "view"
                  ? "Drop view failed"
                  : objectKind === "materialized_view"
                    ? "Drop materialized view failed"
                    : objectKind === "index"
                      ? "Drop index failed"
                      : "Drop table failed",
                err,
              ),
              isLoading: false,
            });
          }
        },

        createSubscription: async (params: CreatePostgresSubscriptionParams) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || dbType !== "postgres") return;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.create, {
              ...connArg,
              params,
            });

            if (!isSameConnectionContext(mode, get(), connKey)) return;
            const tables = (await invokeDatabaseProvider(cmds.getTables, connArg)) as TableInfo[];
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ tables, error: null });
            await get().actions.selectTable(params.name);
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({
              error: formatDatabaseError("Create subscription failed", err),
              isLoading: false,
            });
          }
        },

        dropSubscription: async (name: string, withDropSlot: boolean) => {
          const state = get();
          const connKey = getActiveConnectionKey(mode, state);
          if (!connKey || dbType !== "postgres") return;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.drop, {
              ...connArg,
              subscription: name,
              withDropSlot,
            });

            if (!isSameConnectionContext(mode, get(), connKey)) return;
            const tables = (await invokeDatabaseProvider(cmds.getTables, connArg)) as TableInfo[];
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ tables, error: null });

            if (get().selectedTable === name) {
              const nextObject =
                tables.find((table) => (table.kind ?? "table") === "table") ?? tables[0];
              if (nextObject) {
                await get().actions.selectTable(nextObject.name);
              } else {
                set({
                  ...getClearedSelectionState(),
                  isLoading: false,
                });
              }
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ error: formatDatabaseError("Drop subscription failed", err), isLoading: false });
          }
        },

        setSubscriptionEnabled: async (name: string, enabled: boolean) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.setEnabled, {
              ...connArg,
              subscription: name,
              enabled,
            });
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ error: null });
            if (get().selectedTable === name) {
              await get().actions.refresh();
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({
              error: formatDatabaseError("Update subscription failed", err),
              isLoading: false,
            });
          }
        },

        refreshSubscription: async (name: string, copyData: boolean) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          set({ isLoading: true, error: null });
          try {
            const connArg = getConnectionArg(mode, connKey);
            await invokeDatabaseProvider(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.refresh, {
              ...connArg,
              subscription: name,
              copyData,
            });
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({ error: null });
            if (get().selectedTable === name) {
              await get().actions.refresh();
            } else {
              set({ isLoading: false });
            }
          } catch (err) {
            if (!isSameConnectionContext(mode, get(), connKey)) return;
            set({
              error: formatDatabaseError("Refresh subscription failed", err),
              isLoading: false,
            });
          }
        },

        setColumnWidth: (table: string, column: string, width: number) => {
          set((s) => {
            if (!s.columnWidths[table]) {
              s.columnWidths[table] = {};
            }
            s.columnWidths[table][column] = width;
          });
        },

        navigateToForeignKey: async (toTable: string, toColumn: string, value: unknown) => {
          const actions = get().actions;
          await actions.selectTable(toTable);
          set((s) => {
            s.columnFilters = [{ column: toColumn, operator: "equals", value: String(value) }];
            s.currentPage = 1;
          });
          await actions.refresh();
        },
      },
    })),
  );

  return createSelectors(useStoreBase);
}
