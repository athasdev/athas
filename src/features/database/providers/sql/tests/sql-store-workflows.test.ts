import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import type { ColumnInfo, TableInfo } from "../../../types/common.types";
import {
  createSqlStore,
  POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS,
} from "../stores/create-sql.store";

vi.mock("@/features/database/services/database-provider-sidecar", () => ({
  invokeDatabaseProvider: vi.fn(),
}));

const invoke = vi.mocked(invokeDatabaseProvider);

type Handler = (args: Record<string, unknown>) => unknown;

function routeProvider(routes: Record<string, Handler>) {
  invoke.mockImplementation(async (command: string, args?: unknown) => {
    const handler = routes[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler((args ?? {}) as Record<string, unknown>);
  });
}

function calls(command: string) {
  return invoke.mock.calls
    .filter(([name]) => name === command)
    .map(([, args]) => args as Record<string, unknown>);
}

const usersMeta: ColumnInfo[] = [
  { name: "id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
  { name: "name", type: "TEXT", notnull: false, default_value: null, primary_key: false },
];

const filtered = (rows: unknown[][] = [[1, "Ada"]]) => ({
  columns: ["id", "name"],
  rows,
  total_count: rows.length,
});

function sqliteRoutes(tables: TableInfo[], overrides: Record<string, Handler> = {}) {
  return {
    get_sqlite_tables: () => tables,
    query_sqlite: ({ query }: Record<string, unknown>) => {
      const sql = String(query);
      if (sql.startsWith("PRAGMA table_info")) {
        return {
          columns: ["cid", "name", "type", "notnull", "dflt", "pk"],
          rows: [
            [0, "id", "INTEGER", 1, null, 1],
            [1, "name", "TEXT", 0, "'x'", 0],
          ],
        };
      }
      if (sql.startsWith("PRAGMA user_version")) return { columns: ["v"], rows: [[7]] };
      if (sql.includes("sqlite_master")) return { columns: ["n"], rows: [[2]] };
      return { columns: [], rows: [] };
    },
    query_sqlite_filtered: () => filtered(),
    get_sqlite_foreign_keys: () => [
      { column: "team_id", references_table: "teams", references_column: "id" },
    ],
    execute_sqlite: () => null,
    insert_sqlite_row: () => null,
    update_sqlite_row: () => null,
    delete_sqlite_row: () => null,
    delete_sqlite_row_by_values: () => null,
    update_sqlite_row_by_values: () => null,
    ...overrides,
  } satisfies Record<string, Handler>;
}

beforeEach(() => {
  invoke.mockReset();
});

describe("SQL store initialization", () => {
  it("loads tables, the first table and SQLite database info", async () => {
    routeProvider(
      sqliteRoutes([
        { name: "users_view", kind: "view" },
        { name: "users", kind: "table" },
      ] as TableInfo[]),
    );
    const store = createSqlStore("sqlite", "file");

    await store.getState().actions.init("/data/app.sqlite");

    expect(store.getState()).toMatchObject({
      fileName: "app.sqlite",
      selectedTable: "users",
      selectedObjectKind: "table",
      isLoading: false,
      error: null,
      dbInfo: { version: "7", size: 0, tables: 2, indexes: 2 },
      tableMeta: [
        { name: "id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
        { name: "name", type: "TEXT", notnull: false, default_value: "'x'", primary_key: false },
      ],
      foreignKeys: [{ column: "team_id", references_table: "teams", references_column: "id" }],
      queryResult: { columns: ["id", "name"], rows: [[1, "Ada"]] },
    });
    expect(calls("query_sqlite")[0]).toEqual({
      path: "/data/app.sqlite",
      query: 'PRAGMA table_info("users")',
    });
  });

  it("uses empty database info for server databases and loads their schema", async () => {
    routeProvider({
      get_postgres_tables: () => [{ name: "orders" }],
      get_postgres_table_schema: () => usersMeta,
      get_postgres_foreign_keys: () => {
        throw new Error("permission denied");
      },
      query_postgres_filtered: () => filtered(),
    });
    const store = createSqlStore("postgres", "connection");

    await store.getState().actions.init("pg-1");

    expect(store.getState()).toMatchObject({
      fileName: "pg-1",
      connectionId: "pg-1",
      selectedTable: "orders",
      tableMeta: usersMeta,
      foreignKeys: [],
      dbInfo: { version: "", size: 0, tables: 1, indexes: 0 },
    });
    expect(calls("get_postgres_table_schema")[0]).toEqual({
      connectionId: "pg-1",
      table: "orders",
    });
  });

  it("ignores database info failures", async () => {
    routeProvider(
      sqliteRoutes([{ name: "t" }] as TableInfo[], {
        query_sqlite: ({ query }) => {
          if (String(query).startsWith("PRAGMA table_info")) return { columns: [], rows: [] };
          throw new Error("no pragma");
        },
      }),
    );
    const store = createSqlStore("sqlite", "file");

    await store.getState().actions.init("C:\\data\\win.sqlite");

    expect(store.getState().error).toBeNull();
    expect(store.getState().dbInfo).toBeNull();
  });

  it("reports a database that cannot be opened", async () => {
    routeProvider({
      get_duckdb_tables: () => {
        throw new Error("file is not a database");
      },
    });
    const store = createSqlStore("duckdb", "file");

    await store.getState().actions.init("/tmp/broken.duckdb");

    expect(store.getState().error).toContain("file is not a database");
    expect(store.getState().isLoading).toBe(false);
  });

  it("reports a table whose schema cannot be loaded", async () => {
    routeProvider({
      get_mysql_tables: () => [{ name: "orders" }],
      get_mysql_table_schema: () => {
        throw new Error("table is locked");
      },
    });
    const store = createSqlStore("mysql", "connection");

    await store.getState().actions.init("mysql-1");

    expect(store.getState().error).toContain("table is locked");
    expect(store.getState().isLoading).toBe(false);
  });
});

describe("SQL object kinds", () => {
  it("shows Postgres subscription status instead of table rows", async () => {
    const subscriptionInfo = { name: "sub_a", enabled: true };
    routeProvider({
      get_postgres_tables: () => [{ name: "sub_a", kind: "subscription" }],
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getInfo]: () => subscriptionInfo,
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getStatus]: () => ({
        columns: ["relation", "state"],
        rows: [["public.users", "ready"]],
      }),
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.setEnabled]: () => null,
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.refresh]: () => null,
    });
    const store = createSqlStore("postgres", "connection");

    await store.getState().actions.init("pg-1");

    expect(store.getState()).toMatchObject({
      selectedObjectKind: "subscription",
      subscriptionInfo,
      totalPages: 1,
      tableMeta: [
        { name: "relation", primary_key: true },
        { name: "state", primary_key: false },
      ],
    });

    await store.getState().actions.setSubscriptionEnabled("sub_a", false);
    await store.getState().actions.refreshSubscription("sub_a", true);

    expect(calls(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.setEnabled)[0]).toEqual({
      connectionId: "pg-1",
      subscription: "sub_a",
      enabled: false,
    });
    expect(calls(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.refresh)[0]).toEqual({
      connectionId: "pg-1",
      subscription: "sub_a",
      copyData: true,
    });
    expect(calls(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getStatus)).toHaveLength(3);
    expect(store.getState().isLoading).toBe(false);
  });

  it("does not reload rows when changing an unselected subscription", async () => {
    routeProvider({
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.setEnabled]: () => null,
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.refresh]: () => {
        throw new Error("slot missing");
      },
    });
    const store = createSqlStore("postgres", "connection");
    store.setState({ connectionId: "pg-1", selectedTable: "users" });

    await store.getState().actions.setSubscriptionEnabled("sub_b", true);
    expect(store.getState().isLoading).toBe(false);

    await store.getState().actions.refreshSubscription("sub_b", false);
    expect(store.getState().error).toContain("slot missing");
    expect(store.getState().isLoading).toBe(false);
  });

  it("reports failed subscription toggles and ignores them for other databases", async () => {
    routeProvider({
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.setEnabled]: () => {
        throw new Error("must be owner");
      },
    });
    const postgres = createSqlStore("postgres", "connection");
    postgres.setState({ connectionId: "pg-1" });
    await postgres.getState().actions.setSubscriptionEnabled("sub", true);
    expect(postgres.getState().error).toContain("must be owner");

    const sqlite = createSqlStore("sqlite", "file");
    sqlite.setState({ databasePath: "/a.sqlite" });
    await sqlite.getState().actions.setSubscriptionEnabled("sub", true);
    await sqlite.getState().actions.refreshSubscription("sub", true);
    await sqlite.getState().actions.createSubscription({ name: "sub" } as never);
    await sqlite.getState().actions.dropSubscription("sub", false);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it("selects the created subscription", async () => {
    routeProvider({
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.create]: () => null,
      get_postgres_tables: () => [{ name: "new_sub", kind: "subscription" }],
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getInfo]: () => ({ name: "new_sub" }),
      [POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.getStatus]: () => ({ columns: [], rows: [] }),
    });
    const store = createSqlStore("postgres", "connection");
    store.setState({ connectionId: "pg-1" });

    await store.getState().actions.createSubscription({ name: "new_sub" } as never);

    expect(calls(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS.create)[0]).toEqual({
      connectionId: "pg-1",
      params: { name: "new_sub" },
    });
    expect(store.getState().selectedTable).toBe("new_sub");
  });

  it("shows no rows for an index", async () => {
    routeProvider({ get_sqlite_tables: () => [{ name: "users_idx", kind: "index" }] });
    const store = createSqlStore("sqlite", "file");

    await store.getState().actions.init("/a.sqlite");

    expect(store.getState()).toMatchObject({
      selectedTable: "users_idx",
      selectedObjectKind: "index",
      queryResult: null,
      totalPages: 1,
    });
    await store.getState().actions.refresh();
    expect(calls("query_sqlite_filtered")).toHaveLength(0);
  });
});

describe("SQL row mutations", () => {
  function readyStore() {
    routeProvider(sqliteRoutes([{ name: "users" }] as TableInfo[]));
    const store = createSqlStore("sqlite", "file");
    store.setState({
      databasePath: "/a.sqlite",
      selectedTable: "users",
      selectedObjectKind: "table",
      tableMeta: usersMeta,
      queryResult: { columns: ["id", "name"], rows: [[1, "Ada"]] },
    });
    return store;
  }

  it("inserts, updates and deletes rows by primary key, then reloads the table", async () => {
    const store = readyStore();

    await store.getState().actions.insertRow({ id: 2, name: "Linus" });
    await store.getState().actions.updateRow("id", 2, { id: 2, name: "Grace" });
    await store.getState().actions.deleteRow("id", 2);

    expect(calls("insert_sqlite_row")[0]).toEqual({
      path: "/a.sqlite",
      table: "users",
      columns: ["id", "name"],
      values: [2, "Linus"],
    });
    expect(calls("update_sqlite_row")[0]).toEqual({
      path: "/a.sqlite",
      table: "users",
      setColumns: ["name"],
      setValues: ["Grace"],
      whereColumn: "id",
      whereValue: 2,
    });
    expect(calls("delete_sqlite_row")[0]).toEqual({
      path: "/a.sqlite",
      table: "users",
      whereColumn: "id",
      whereValue: 2,
    });
    expect(calls("query_sqlite_filtered")).toHaveLength(3);
    expect(store.getState()).toMatchObject({ isLoading: false, error: null });
  });

  it("updates a cell by primary key", async () => {
    const store = readyStore();

    await store.getState().actions.updateCell(0, "name", "Ada L.");

    expect(calls("update_sqlite_row")[0]).toMatchObject({
      setColumns: ["name"],
      setValues: ["Ada L."],
      whereColumn: "id",
      whereValue: 1,
    });
  });

  it("reports failed inserts, updates and deletes", async () => {
    const store = readyStore();
    const fail = () => {
      throw new Error("constraint failed");
    };
    routeProvider(
      sqliteRoutes([], {
        insert_sqlite_row: fail,
        update_sqlite_row: fail,
        delete_sqlite_row: fail,
        update_sqlite_row_by_values: fail,
        delete_sqlite_row_by_values: fail,
      }),
    );

    await store.getState().actions.insertRow({ id: 1 });
    expect(store.getState().error).toMatch(/^Insert failed/);
    await store.getState().actions.updateRow("id", 1, { name: "x" });
    expect(store.getState().error).toMatch(/^Update failed/);
    await store.getState().actions.updateRowByValues({ id: 1 }, { name: "x" });
    expect(store.getState().error).toMatch(/^Update failed/);
    await store.getState().actions.deleteRow("id", 1);
    expect(store.getState().error).toMatch(/^Delete failed/);
    await store.getState().actions.deleteRowByValues({ id: 1 });
    expect(store.getState().error).toMatch(/^Delete failed/);
    await store.getState().actions.updateCell(0, "name", "x");
    expect(store.getState().error).toMatch(/^Cell update failed/);
    expect(store.getState().isLoading).toBe(false);
  });

  it("ignores mutations without a selected table", async () => {
    const store = createSqlStore("sqlite", "file");
    store.setState({ databasePath: "/a.sqlite" });

    await store.getState().actions.insertRow({ id: 1 });
    await store.getState().actions.updateRow("id", 1, {});
    await store.getState().actions.updateRowByValues({}, {});
    await store.getState().actions.deleteRow("id", 1);
    await store.getState().actions.deleteRowByValues({});
    await store.getState().actions.updateCell(0, "id", 1);

    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("SQL schema changes", () => {
  it("creates a table with quoted columns and selects it", async () => {
    routeProvider(sqliteRoutes([{ name: "users" }, { name: 'odd"name' }] as TableInfo[]));
    const store = createSqlStore("sqlite", "file");
    store.setState({ databasePath: "/a.sqlite", selectedTable: "users" });

    await store.getState().actions.createTable('odd"name', [
      { name: "id", type: "INTEGER", notnull: true },
      { name: 'la"bel', type: "TEXT", notnull: false },
    ]);

    expect(calls("execute_sqlite")[0]).toEqual({
      path: "/a.sqlite",
      statement: 'CREATE TABLE "odd""name" ("id" INTEGER NOT NULL, "la""bel" TEXT)',
    });
    expect(store.getState().selectedTable).toBe('odd"name');
  });

  it("reports a failed table creation", async () => {
    routeProvider(
      sqliteRoutes([], {
        execute_sqlite: () => {
          throw new Error("table exists");
        },
      }),
    );
    const store = createSqlStore("sqlite", "file");
    store.setState({ databasePath: "/a.sqlite" });

    await store.getState().actions.createTable("users", []);

    expect(store.getState().error).toMatch(/^Create table failed/);
    expect(store.getState().isLoading).toBe(false);
  });

  it("names the object kind when a drop fails", async () => {
    routeProvider(
      sqliteRoutes([], {
        execute_sqlite: () => {
          throw new Error("in use");
        },
      }),
    );
    const store = createSqlStore("sqlite", "file");
    store.setState({
      databasePath: "/a.sqlite",
      tables: [
        { name: "v", kind: "view" },
        { name: "mv", kind: "materialized_view" },
        { name: "i", kind: "index" },
        { name: "t", kind: "table" },
      ] as TableInfo[],
    });

    const errors: string[] = [];
    for (const name of ["v", "mv", "i", "t"]) {
      await store.getState().actions.dropTable(name);
      errors.push(String(store.getState().error).split(":")[0]);
    }

    expect(errors).toEqual([
      "Drop view failed",
      "Drop materialized view failed",
      "Drop index failed",
      "Drop table failed",
    ]);
  });

  it("refuses to drop a MySQL index without its table", async () => {
    routeProvider({ execute_mysql: () => null });
    const store = createSqlStore("mysql", "connection");
    store.setState({
      connectionId: "m",
      tables: [{ name: "idx", kind: "index" }] as TableInfo[],
    });

    await store.getState().actions.dropTable("idx");

    expect(store.getState().error).toContain("MySQL index metadata is missing the table name");
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("SQL table view state", () => {
  function tableStore() {
    routeProvider(sqliteRoutes([{ name: "users" }, { name: "teams" }] as TableInfo[]));
    const store = createSqlStore("sqlite", "file");
    store.setState({
      databasePath: "/a.sqlite",
      tables: [{ name: "users" }, { name: "teams" }] as TableInfo[],
      selectedTable: "users",
      selectedObjectKind: "table",
      tableMeta: usersMeta,
    });
    return store;
  }

  it("filters, sorts and clears filters with a reload each time", async () => {
    const store = tableStore();
    const { actions } = store.getState();

    actions.addColumnFilter("name");
    actions.updateColumnFilter(0, { operator: "equals", value: "Ada" });
    actions.toggleSort("name");
    actions.toggleSort("name");
    actions.toggleSort("id");
    await vi.waitFor(() => expect(calls("query_sqlite_filtered")).toHaveLength(4));

    expect(store.getState()).toMatchObject({
      columnFilters: [{ column: "name", operator: "equals", value: "Ada" }],
      sortColumn: "id",
      sortDirection: "asc",
    });
    expect(calls("query_sqlite_filtered").map((args) => args.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sort_column: "name", sort_direction: "DESC" }),
      ]),
    );

    actions.removeColumnFilter(0);
    actions.clearFilters();
    await vi.waitFor(() => expect(calls("query_sqlite_filtered")).toHaveLength(6));
    expect(store.getState().columnFilters).toEqual([]);
  });

  it("ignores filter and sort changes outside tables", () => {
    const store = tableStore();
    store.setState({ selectedObjectKind: "view" });
    const { actions } = store.getState();

    actions.addColumnFilter("name");
    actions.removeColumnFilter(0);
    actions.clearFilters();
    actions.toggleSort("name");

    expect(store.getState().columnFilters).toEqual([]);
    expect(store.getState().sortColumn).toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("remembers column widths per table", () => {
    const store = tableStore();

    store.getState().actions.setColumnWidth("users", "name", 240);
    store.getState().actions.setColumnWidth("users", "id", 80);
    store.getState().actions.setColumnWidth("teams", "id", 90);

    expect(store.getState().columnWidths).toEqual({
      users: { name: 240, id: 80 },
      teams: { id: 90 },
    });
  });

  it("follows a foreign key to the matching rows of the referenced table", async () => {
    const store = tableStore();

    await store.getState().actions.navigateToForeignKey("teams", "id", 42);

    expect(store.getState()).toMatchObject({
      selectedTable: "teams",
      columnFilters: [{ column: "id", operator: "equals", value: "42" }],
      currentPage: 1,
    });
    const filteredCalls = calls("query_sqlite_filtered");
    const lastQuery = filteredCalls[filteredCalls.length - 1];
    expect(lastQuery).toMatchObject({
      params: {
        table: "teams",
        filters: [{ column: "id", operator: "equals", value: "42", value2: null }],
        offset: 0,
      },
    });
  });
});
