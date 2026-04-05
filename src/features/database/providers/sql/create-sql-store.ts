import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createSelectors } from "@/utils/zustand-selectors";
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
} from "../../models/common.types";
import type { DatabaseType } from "../../models/provider.types";

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

  currentPage: number;
  pageSize: number;
  totalPages: number;

  searchTerm: string;
  columnFilters: ColumnFilter[];
  sortColumn: string | null;
  sortDirection: "asc" | "desc";

  customQuery: string;
  isCustomQuery: boolean;
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
  executeCustomQuery: () => Promise<void>;

  insertRow: (values: Record<string, unknown>) => Promise<void>;
  updateRow: (pkColumn: string, pkValue: unknown, values: Record<string, unknown>) => Promise<void>;
  deleteRow: (pkColumn: string, pkValue: unknown) => Promise<void>;
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
  deleteRow: string;
  getForeignKeys: string;
}

function getCommandMap(dbType: DatabaseType): CommandMap {
  return {
    getTables: `get_${dbType}_tables`,
    query: `query_${dbType}`,
    queryFiltered: `query_${dbType}_filtered`,
    execute: `execute_${dbType}`,
    insertRow: `insert_${dbType}_row`,
    updateRow: `update_${dbType}_row`,
    deleteRow: `delete_${dbType}_row`,
    getForeignKeys: `get_${dbType}_foreign_keys`,
  };
}

function getConnectionArg(mode: ConnectionMode, pathOrId: string) {
  return mode === "file" ? { path: pathOrId } : { connectionId: pathOrId };
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
  currentPage: 1,
  pageSize: 50,
  totalPages: 1,
  searchTerm: "",
  columnFilters: [],
  sortColumn: null,
  sortDirection: "asc",
  customQuery: "",
  isCustomQuery: false,
  sqlHistory: [],
  columnWidths: {},
};

function getObjectKind(objects: TableInfo[], name: string | null | undefined): DatabaseObjectKind {
  if (!name) return "table";
  return objects.find((object) => object.name === name)?.kind ?? "table";
}

export function createSqlStore(dbType: DatabaseType, mode: ConnectionMode) {
  const cmds = getCommandMap(dbType);

  const useStoreBase = create<SqlDatabaseState & { actions: SqlDatabaseActions }>()(
    immer((set, get) => ({
      ...initialState,

      actions: {
        init: async (pathOrConnectionId: string) => {
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

          set({ ...connState, fileName, isLoading: true, error: null });

          try {
            const connArg = getConnectionArg(mode, pathOrConnectionId);
            const tables = (await invoke(cmds.getTables, connArg)) as TableInfo[];
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
                const versionResult = (await invoke(cmds.query, {
                  ...connArg,
                  query: versionQuery,
                })) as QueryResult;

                const indexQuery =
                  dbType === "sqlite"
                    ? "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';"
                    : "SELECT COUNT(*) FROM duckdb_indexes();";
                const indexResult = (await invoke(cmds.query, {
                  ...connArg,
                  query: indexQuery,
                })) as QueryResult;

                set({
                  dbInfo: {
                    version: versionResult.rows[0]?.[0]?.toString() || "0",
                    size: 0,
                    tables: tables.length,
                    indexes: Number(indexResult.rows[0]?.[0]) || 0,
                  },
                });
              } else {
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
            set({ error: `Failed to load database: ${err}` });
          } finally {
            set({ isLoading: false });
          }
        },

        reset: () => set(initialState),

        selectTable: async (tableName: string) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey) return;
          const selectedObjectKind = getObjectKind(state.tables, tableName);

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
          });

          try {
            const connArg = getConnectionArg(mode, connKey);

            if (selectedObjectKind === "subscription" && dbType === "postgres") {
              const [subscriptionInfo, queryResult] = await Promise.all([
                invoke("get_postgres_subscription_info", {
                  ...connArg,
                  subscription: tableName,
                }) as Promise<PostgresSubscriptionInfo>,
                invoke("get_postgres_subscription_status", {
                  ...connArg,
                  subscription: tableName,
                }) as Promise<QueryResult>,
              ]);

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

            // Get table schema - provider-specific PRAGMA or information_schema
            let tableMeta: ColumnInfo[];
            if (dbType === "sqlite" || dbType === "duckdb") {
              const result = (await invoke(cmds.query, {
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
              const result = (await invoke(`get_${dbType}_table_schema`, {
                ...connArg,
                table: tableName,
              })) as ColumnInfo[];
              tableMeta = result;
            }

            set({ tableMeta });

            // Load foreign keys
            try {
              const foreignKeys = (await invoke(cmds.getForeignKeys, {
                ...connArg,
                table: tableName,
              })) as ForeignKeyInfo[];
              set({ foreignKeys });
            } catch {
              set({ foreignKeys: [] });
            }

            await get().actions.refresh();
          } catch (err) {
            set({ error: `Failed to load table: ${err}` });
          } finally {
            set({ isLoading: false });
          }
        },

        refresh: async () => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.selectedTable || state.isCustomQuery) return;

          set({ isLoading: true, error: null });

          try {
            const connArg = getConnectionArg(mode, connKey);

            if (state.selectedObjectKind === "subscription" && dbType === "postgres") {
              const [subscriptionInfo, queryResult] = await Promise.all([
                invoke("get_postgres_subscription_info", {
                  ...connArg,
                  subscription: state.selectedTable,
                }) as Promise<PostgresSubscriptionInfo>,
                invoke("get_postgres_subscription_status", {
                  ...connArg,
                  subscription: state.selectedTable,
                }) as Promise<QueryResult>,
              ]);

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

            const result = (await invoke(cmds.queryFiltered, {
              ...connArg,
              params: {
                table: state.selectedTable,
                filters: state.columnFilters.map((f) => ({
                  column: f.column,
                  operator: f.operator,
                  value: f.value,
                  value2: f.value2 ?? null,
                })),
                search_term: state.searchTerm.trim() || null,
                search_columns: state.searchTerm.trim() ? state.tableMeta.map((c) => c.name) : [],
                sort_column: state.sortColumn ?? null,
                sort_direction: state.sortDirection.toUpperCase(),
                page_size: state.pageSize,
                offset,
              },
            })) as FilteredQueryResult;

            const totalPages = Math.max(1, Math.ceil(result.total_count / state.pageSize));

            set({
              queryResult: { columns: result.columns, rows: result.rows },
              totalPages,
            });
          } catch (err) {
            set({ error: `Query failed: ${err}`, queryResult: null });
          } finally {
            set({ isLoading: false });
          }
        },

        setSearchTerm: (term: string) => {
          if (get().selectedObjectKind !== "table") return;
          set({ searchTerm: term, currentPage: 1 });
          get().actions.refresh();
        },

        setCurrentPage: (page: number) => {
          if (get().selectedObjectKind !== "table") return;
          set({ currentPage: page });
          get().actions.refresh();
        },

        setPageSize: (size: number) => {
          if (get().selectedObjectKind !== "table") return;
          set({ pageSize: size, currentPage: 1 });
          get().actions.refresh();
        },

        addColumnFilter: (column: string) => {
          if (get().selectedObjectKind !== "table") return;
          set((s) => {
            s.columnFilters.push({ column, operator: "contains", value: "" });
          });
        },

        updateColumnFilter: (index: number, updates: Partial<ColumnFilter>) => {
          if (get().selectedObjectKind !== "table") return;
          set((s) => {
            s.columnFilters[index] = { ...s.columnFilters[index], ...updates };
            s.currentPage = 1;
          });
          get().actions.refresh();
        },

        removeColumnFilter: (index: number) => {
          if (get().selectedObjectKind !== "table") return;
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
        setIsCustomQuery: (is: boolean) => set({ isCustomQuery: is }),

        executeCustomQuery: async () => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.customQuery.trim()) return;

          set({ isLoading: true, error: null, isCustomQuery: true });

          try {
            const connArg = getConnectionArg(mode, connKey);
            const queryResult = (await invoke(cmds.query, {
              ...connArg,
              query: state.customQuery,
            })) as QueryResult;

            const newHistory = state.sqlHistory.includes(state.customQuery)
              ? state.sqlHistory
              : [state.customQuery, ...state.sqlHistory].slice(0, 10);

            set({ queryResult, sqlHistory: newHistory });
          } catch (err) {
            set({ error: `Query error: ${err}`, queryResult: null });
          } finally {
            set({ isLoading: false });
          }
        },

        insertRow: async (values: Record<string, unknown>) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke(cmds.insertRow, {
              ...connArg,
              table: state.selectedTable,
              columns: Object.keys(values),
              values: Object.values(values),
            });
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            set({ error: `Insert failed: ${err}` });
          }
        },

        updateRow: async (pkColumn: string, pkValue: unknown, values: Record<string, unknown>) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;

          const { [pkColumn]: _, ...updateValues } = values;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke(cmds.updateRow, {
              ...connArg,
              table: state.selectedTable,
              setColumns: Object.keys(updateValues),
              setValues: Object.values(updateValues),
              whereColumn: pkColumn,
              whereValue: pkValue,
            });
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            set({ error: `Update failed: ${err}` });
          }
        },

        deleteRow: async (pkColumn: string, pkValue: unknown) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || !state.selectedTable || state.selectedObjectKind !== "table") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke(cmds.deleteRow, {
              ...connArg,
              table: state.selectedTable,
              whereColumn: pkColumn,
              whereValue: pkValue,
            });
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            set({ error: `Delete failed: ${err}` });
          }
        },

        updateCell: async (rowIndex: number, columnName: string, newValue: unknown) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (
            !connKey ||
            !state.selectedTable ||
            !state.queryResult ||
            state.selectedObjectKind !== "table"
          )
            return;

          const pkColumn = state.tableMeta.find((c) => c.primary_key);
          if (!pkColumn) {
            set({ error: "No primary key found" });
            return;
          }

          const row = state.queryResult.rows[rowIndex];
          const pkIndex = state.queryResult.columns.indexOf(pkColumn.name);
          const pkValue = row[pkIndex];

          if (pkValue === undefined || pkValue === null) {
            set({ error: "Primary key value missing" });
            return;
          }

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke(cmds.updateRow, {
              ...connArg,
              table: state.selectedTable,
              setColumns: [columnName],
              setValues: [newValue],
              whereColumn: pkColumn.name,
              whereValue: pkValue,
            });
            set({ error: null });
            await get().actions.refresh();
          } catch (err) {
            set({ error: `Cell update failed: ${err}` });
          }
        },

        createTable: async (
          name: string,
          columns: { name: string; type: string; notnull: boolean }[],
        ) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey) return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            const columnDefs = columns
              .map(
                (c) => `"${c.name.replace(/"/g, '""')}" ${c.type}${c.notnull ? " NOT NULL" : ""}`,
              )
              .join(", ");

            await invoke(cmds.execute, {
              ...connArg,
              statement: `CREATE TABLE "${name.replace(/"/g, '""')}" (${columnDefs})`,
            });

            const tables = (await invoke(cmds.getTables, connArg)) as TableInfo[];
            set({ tables, error: null });
            await get().actions.selectTable(name);
          } catch (err) {
            set({ error: `Create table failed: ${err}` });
          }
        },

        dropTable: async (name: string) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey) return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke(cmds.execute, {
              ...connArg,
              statement: `DROP TABLE "${name.replace(/"/g, '""')}"`,
            });

            const tables = (await invoke(cmds.getTables, connArg)) as TableInfo[];
            set({ tables, error: null });

            if (state.selectedTable === name) {
              if (tables.length > 0) {
                const nextObject =
                  tables.find((table) => (table.kind ?? "table") === "table") ?? tables[0];
                await get().actions.selectTable(nextObject.name);
              } else {
                set({
                  selectedTable: null,
                  selectedObjectKind: "table",
                  queryResult: null,
                  tableMeta: [],
                  foreignKeys: [],
                  subscriptionInfo: null,
                });
              }
            }
          } catch (err) {
            set({ error: `Drop table failed: ${err}` });
          }
        },

        createSubscription: async (params: CreatePostgresSubscriptionParams) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke("create_postgres_subscription", {
              ...connArg,
              params,
            });

            const tables = (await invoke(cmds.getTables, connArg)) as TableInfo[];
            set({ tables, error: null });
            await get().actions.selectTable(params.name);
          } catch (err) {
            set({ error: `Create subscription failed: ${err}` });
          }
        },

        dropSubscription: async (name: string, withDropSlot: boolean) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke("drop_postgres_subscription", {
              ...connArg,
              subscription: name,
              withDropSlot,
            });

            const tables = (await invoke(cmds.getTables, connArg)) as TableInfo[];
            set({ tables, error: null });

            if (state.selectedTable === name) {
              const nextObject =
                tables.find((table) => (table.kind ?? "table") === "table") ?? tables[0];
              if (nextObject) {
                await get().actions.selectTable(nextObject.name);
              } else {
                set({
                  selectedTable: null,
                  selectedObjectKind: "table",
                  queryResult: null,
                  tableMeta: [],
                  foreignKeys: [],
                  subscriptionInfo: null,
                });
              }
            }
          } catch (err) {
            set({ error: `Drop subscription failed: ${err}` });
          }
        },

        setSubscriptionEnabled: async (name: string, enabled: boolean) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke("set_postgres_subscription_enabled", {
              ...connArg,
              subscription: name,
              enabled,
            });
            set({ error: null });
            if (state.selectedTable === name) {
              await get().actions.refresh();
            }
          } catch (err) {
            set({ error: `Update subscription failed: ${err}` });
          }
        },

        refreshSubscription: async (name: string, copyData: boolean) => {
          const state = get();
          const connKey = mode === "file" ? state.databasePath : state.connectionId;
          if (!connKey || dbType !== "postgres") return;

          try {
            const connArg = getConnectionArg(mode, connKey);
            await invoke("refresh_postgres_subscription", {
              ...connArg,
              subscription: name,
              copyData,
            });
            set({ error: null });
            if (state.selectedTable === name) {
              await get().actions.refresh();
            }
          } catch (err) {
            set({ error: `Refresh subscription failed: ${err}` });
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
