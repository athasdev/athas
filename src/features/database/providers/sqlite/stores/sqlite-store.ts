import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import type {
  ColumnFilter,
  ColumnInfo,
  DatabaseInfo,
  QueryResult,
  TableInfo,
} from "../../../models/common.types";

interface SqliteState {
  databasePath: string | null;
  fileName: string;
  tables: TableInfo[];
  selectedTable: string | null;
  queryResult: QueryResult | null;
  tableMeta: ColumnInfo[];
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
}

interface SqliteActions {
  init: (databasePath: string) => Promise<void>;
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
}

const initialState: SqliteState = {
  databasePath: null,
  fileName: "",
  tables: [],
  selectedTable: null,
  queryResult: null,
  tableMeta: [],
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
};

export const useSqliteStore = create<SqliteState & { actions: SqliteActions }>()(
  immer((set, get) => ({
    ...initialState,

    actions: {
      init: async (databasePath: string) => {
        const fileName =
          databasePath.split("/").pop() || databasePath.split("\\").pop() || "Database";
        set({ databasePath, fileName, isLoading: true, error: null });

        try {
          const tables = (await invoke("get_sqlite_tables", { path: databasePath })) as TableInfo[];
          set({ tables });

          if (tables.length > 0) {
            await get().actions.selectTable(tables[0].name);
          }

          try {
            const versionResult = (await invoke("query_sqlite", {
              path: databasePath,
              query: "PRAGMA user_version;",
            })) as QueryResult;

            const indexResult = (await invoke("query_sqlite", {
              path: databasePath,
              query:
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%';",
            })) as QueryResult;

            set({
              dbInfo: {
                version: versionResult.rows[0]?.[0]?.toString() || "0",
                size: 0,
                tables: tables.length,
                indexes: Number(indexResult.rows[0]?.[0]) || 0,
              },
            });
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
        const { databasePath } = get();
        if (!databasePath) return;

        set({
          selectedTable: tableName,
          currentPage: 1,
          searchTerm: "",
          isCustomQuery: false,
          columnFilters: [],
          sortColumn: null,
          isLoading: true,
        });

        try {
          const result = (await invoke("query_sqlite", {
            path: databasePath,
            query: `PRAGMA table_info(${tableName})`,
          })) as QueryResult;

          const tableMeta: ColumnInfo[] = result.rows.map((row) => ({
            name: row[1] as string,
            type: row[2] as string,
            notnull: Boolean(row[3]),
            default_value: row[4] as string | null,
            primary_key: Boolean(row[5]),
          }));

          set({ tableMeta });
          await get().actions.refresh();
        } catch (err) {
          set({ error: `Failed to load table: ${err}` });
        } finally {
          set({ isLoading: false });
        }
      },

      refresh: async () => {
        const state = get();
        if (!state.databasePath || !state.selectedTable || state.isCustomQuery) return;

        set({ isLoading: true, error: null });

        try {
          const whereConditions: string[] = [];

          if (state.searchTerm.trim() && state.tableMeta.length > 0) {
            const cols = state.tableMeta.map((c) => `"${c.name}"`).join(' || " " || ');
            whereConditions.push(`(${cols}) LIKE "%${state.searchTerm}%"`);
          }

          for (const filter of state.columnFilters) {
            switch (filter.operator) {
              case "equals":
                whereConditions.push(`"${filter.column}" = "${filter.value}"`);
                break;
              case "contains":
                whereConditions.push(`"${filter.column}" LIKE "%${filter.value}%"`);
                break;
              case "startsWith":
                whereConditions.push(`"${filter.column}" LIKE "${filter.value}%"`);
                break;
              case "endsWith":
                whereConditions.push(`"${filter.column}" LIKE "%${filter.value}"`);
                break;
              case "gt":
                whereConditions.push(`"${filter.column}" > "${filter.value}"`);
                break;
              case "lt":
                whereConditions.push(`"${filter.column}" < "${filter.value}"`);
                break;
              case "between":
                if (filter.value2) {
                  whereConditions.push(
                    `"${filter.column}" BETWEEN "${filter.value}" AND "${filter.value2}"`,
                  );
                }
                break;
            }
          }

          const whereClause =
            whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";
          const orderClause = state.sortColumn
            ? `ORDER BY "${state.sortColumn}" ${state.sortDirection.toUpperCase()}`
            : "";

          const countResult = (await invoke("query_sqlite", {
            path: state.databasePath,
            query: `SELECT COUNT(*) FROM "${state.selectedTable}" ${whereClause}`,
          })) as QueryResult;

          const totalRows = Number(countResult.rows[0][0]);
          const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
          const offset = (state.currentPage - 1) * state.pageSize;

          const queryResult = (await invoke("query_sqlite", {
            path: state.databasePath,
            query: `SELECT * FROM "${state.selectedTable}" ${whereClause} ${orderClause} LIMIT ${state.pageSize} OFFSET ${offset}`,
          })) as QueryResult;

          set({ queryResult, totalPages });
        } catch (err) {
          set({ error: `Query failed: ${err}`, queryResult: null });
        } finally {
          set({ isLoading: false });
        }
      },

      setSearchTerm: (term: string) => {
        set({ searchTerm: term, currentPage: 1 });
        get().actions.refresh();
      },

      setCurrentPage: (page: number) => {
        set({ currentPage: page });
        get().actions.refresh();
      },

      setPageSize: (size: number) => {
        set({ pageSize: size, currentPage: 1 });
        get().actions.refresh();
      },

      addColumnFilter: (column: string) => {
        set((s) => {
          s.columnFilters.push({ column, operator: "contains", value: "" });
        });
      },

      updateColumnFilter: (index: number, updates: Partial<ColumnFilter>) => {
        set((s) => {
          s.columnFilters[index] = { ...s.columnFilters[index], ...updates };
          s.currentPage = 1;
        });
        get().actions.refresh();
      },

      removeColumnFilter: (index: number) => {
        set((s) => {
          s.columnFilters.splice(index, 1);
          s.currentPage = 1;
        });
        get().actions.refresh();
      },

      clearFilters: () => {
        set({ columnFilters: [], currentPage: 1 });
        get().actions.refresh();
      },

      toggleSort: (column: string) => {
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
        const { databasePath, customQuery, sqlHistory } = get();
        if (!databasePath || !customQuery.trim()) return;

        set({ isLoading: true, error: null, isCustomQuery: true });

        try {
          const queryResult = (await invoke("query_sqlite", {
            path: databasePath,
            query: customQuery,
          })) as QueryResult;

          const newHistory = sqlHistory.includes(customQuery)
            ? sqlHistory
            : [customQuery, ...sqlHistory].slice(0, 10);

          set({ queryResult, sqlHistory: newHistory });
        } catch (err) {
          set({ error: `Query error: ${err}`, queryResult: null });
        } finally {
          set({ isLoading: false });
        }
      },

      insertRow: async (values: Record<string, unknown>) => {
        const { databasePath, selectedTable } = get();
        if (!databasePath || !selectedTable) return;

        try {
          await invoke("insert_sqlite_row", {
            path: databasePath,
            table: selectedTable,
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
        const { databasePath, selectedTable } = get();
        if (!databasePath || !selectedTable) return;

        const { [pkColumn]: _, ...updateValues } = values;

        try {
          await invoke("update_sqlite_row", {
            path: databasePath,
            table: selectedTable,
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
        const { databasePath, selectedTable } = get();
        if (!databasePath || !selectedTable) return;

        try {
          await invoke("delete_sqlite_row", {
            path: databasePath,
            table: selectedTable,
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
        const { databasePath, selectedTable, queryResult, tableMeta } = get();
        if (!databasePath || !selectedTable || !queryResult) return;

        const pkColumn = tableMeta.find((c) => c.primary_key);
        if (!pkColumn) {
          set({ error: "No primary key found" });
          return;
        }

        const row = queryResult.rows[rowIndex];
        const pkIndex = queryResult.columns.indexOf(pkColumn.name);
        const pkValue = row[pkIndex];

        if (pkValue === undefined || pkValue === null) {
          set({ error: "Primary key value missing" });
          return;
        }

        try {
          await invoke("update_sqlite_row", {
            path: databasePath,
            table: selectedTable,
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
        const { databasePath } = get();
        if (!databasePath) return;

        try {
          const columnDefs = columns
            .map((c) => `"${c.name}" ${c.type}${c.notnull ? " NOT NULL" : ""}`)
            .join(", ");

          await invoke("execute_sqlite", {
            path: databasePath,
            statement: `CREATE TABLE "${name}" (${columnDefs})`,
          });

          const tables = (await invoke("get_sqlite_tables", { path: databasePath })) as TableInfo[];
          set({ tables, error: null });
          await get().actions.selectTable(name);
        } catch (err) {
          set({ error: `Create table failed: ${err}` });
        }
      },

      dropTable: async (name: string) => {
        const { databasePath, selectedTable } = get();
        if (!databasePath) return;

        try {
          await invoke("execute_sqlite", {
            path: databasePath,
            statement: `DROP TABLE "${name}"`,
          });

          const tables = (await invoke("get_sqlite_tables", { path: databasePath })) as TableInfo[];
          set({ tables, error: null });

          if (selectedTable === name) {
            if (tables.length > 0) {
              await get().actions.selectTable(tables[0].name);
            } else {
              set({ selectedTable: null, queryResult: null, tableMeta: [] });
            }
          }
        } catch (err) {
          set({ error: `Drop table failed: ${err}` });
        }
      },
    },
  })),
);
