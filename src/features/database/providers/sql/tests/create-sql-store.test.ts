import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { getSqlHistoryStorageKey } from "../../../lib/sql-history-storage";
import type { ColumnInfo, FilteredQueryResult, QueryResult } from "../../../types/common.types";
import { createSqlStore } from "../stores/create-sql.store";

vi.mock("@/features/database/services/database-provider-sidecar", () => ({
  invokeDatabaseProvider: vi.fn(),
}));

const mockInvokeDatabaseProvider = vi.mocked(invokeDatabaseProvider);

function createMemoryStorage(): Storage {
  const items = new Map<string, string>();

  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => Array.from(items.keys())[index] ?? null,
    removeItem: (key: string) => items.delete(key),
    setItem: (key: string, value: string) => items.set(key, value),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

const tableMeta: ColumnInfo[] = [
  { name: "id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
  { name: "name", type: "TEXT", notnull: false, default_value: null, primary_key: false },
];

const noPrimaryKeyMeta: ColumnInfo[] = [
  { name: "name", type: "TEXT", notnull: false, default_value: null, primary_key: false },
  { name: "email", type: "TEXT", notnull: false, default_value: null, primary_key: false },
];

function createReadyStore() {
  const store = createSqlStore("duckdb", "file");
  store.setState({
    databasePath: "/tmp/app.duckdb",
    selectedTable: "users",
    selectedObjectKind: "table",
    tableMeta,
    queryResult: { columns: ["id", "name"], rows: [[1, "Initial"]] },
  });
  return store;
}

function createReadyMySqlStore() {
  const store = createSqlStore("mysql", "connection");
  store.setState({
    connectionId: "mysql-local",
    selectedTable: "users",
    selectedObjectKind: "table",
    tableMeta,
    queryResult: { columns: ["id", "name"], rows: [[1, "Initial"]] },
  });
  return store;
}

function createReadyPostgresStore() {
  const store = createSqlStore("postgres", "connection");
  store.setState({
    connectionId: "pg-local",
    selectedTable: "users",
    selectedObjectKind: "table",
    tableMeta,
    queryResult: { columns: ["id", "name"], rows: [[1, "Initial"]] },
  });
  return store;
}

function filteredResult(name: string): FilteredQueryResult {
  return {
    columns: ["id", "name"],
    rows: [[1, name]],
    total_count: 1,
  };
}

function createNoPrimaryKeyStore() {
  const store = createSqlStore("duckdb", "file");
  store.setState({
    databasePath: "/tmp/app.duckdb",
    selectedTable: "users",
    selectedObjectKind: "table",
    tableMeta: noPrimaryKeyMeta,
    queryResult: {
      columns: ["name", "email"],
      rows: [["Alice", null]],
    },
  });
  return store;
}

describe("createSqlStore reliability", () => {
  beforeEach(() => {
    mockInvokeDatabaseProvider.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps stale search responses from replacing newer results", async () => {
    const first = deferred<FilteredQueryResult>();
    const second = deferred<FilteredQueryResult>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const store = createReadyStore();

    store.getState().actions.setSearchTerm("a");
    store.getState().actions.setSearchTerm("al");

    second.resolve(filteredResult("Alice"));
    await flushPromises();

    expect(store.getState().queryResult?.rows).toEqual([[1, "Alice"]]);
    expect(store.getState().isLoading).toBe(false);

    first.resolve(filteredResult("Archived"));
    await flushPromises();

    expect(store.getState().queryResult?.rows).toEqual([[1, "Alice"]]);
    expect(store.getState().searchTerm).toBe("al");
  });

  it("keeps stale page and sort responses from replacing newer results", async () => {
    const pageRequest = deferred<FilteredQueryResult>();
    const sortRequest = deferred<FilteredQueryResult>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(pageRequest.promise)
      .mockReturnValueOnce(sortRequest.promise);

    const store = createReadyStore();

    store.getState().actions.setCurrentPage(2);
    store.getState().actions.toggleSort("name");

    sortRequest.resolve(filteredResult("Sorted"));
    await flushPromises();

    expect(store.getState().queryResult?.rows).toEqual([[1, "Sorted"]]);
    expect(store.getState().sortColumn).toBe("name");

    pageRequest.resolve(filteredResult("Page 2"));
    await flushPromises();

    expect(store.getState().queryResult?.rows).toEqual([[1, "Sorted"]]);
  });

  it("keeps existing table data when a refresh fails", async () => {
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("network down"));
    const store = createReadyStore();

    await store.getState().actions.refresh();

    expect(store.getState().queryResult).toEqual({
      columns: ["id", "name"],
      rows: [[1, "Initial"]],
    });
    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBe("Query failed: network down");
  });

  it("clamps requested pages before refreshing", async () => {
    mockInvokeDatabaseProvider.mockResolvedValue(filteredResult("Clamped"));
    const store = createReadyStore();
    store.setState({ totalPages: 3 });

    store.getState().actions.setCurrentPage(99);
    await flushPromises();

    expect(store.getState().currentPage).toBe(3);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_duckdb_filtered", {
      path: "/tmp/app.duckdb",
      params: {
        table: "users",
        filters: [],
        search_term: null,
        search_columns: [],
        sort_column: null,
        sort_direction: "ASC",
        page_size: 50,
        offset: 100,
      },
    });

    store.getState().actions.setCurrentPage(0);
    await flushPromises();

    expect(store.getState().currentPage).toBe(1);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_duckdb_filtered", {
      path: "/tmp/app.duckdb",
      params: {
        table: "users",
        filters: [],
        search_term: null,
        search_columns: [],
        sort_column: null,
        sort_direction: "ASC",
        page_size: 50,
        offset: 0,
      },
    });
  });

  it("normalizes page size before refreshing", async () => {
    mockInvokeDatabaseProvider.mockResolvedValue(filteredResult("Sized"));
    const store = createReadyStore();

    store.getState().actions.setPageSize(0);
    await flushPromises();

    expect(store.getState().pageSize).toBe(1);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_duckdb_filtered", {
      path: "/tmp/app.duckdb",
      params: {
        table: "users",
        filters: [],
        search_term: null,
        search_columns: [],
        sort_column: null,
        sort_direction: "ASC",
        page_size: 1,
        offset: 0,
      },
    });

    store.getState().actions.setPageSize(999);
    await flushPromises();

    expect(store.getState().pageSize).toBe(500);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_duckdb_filtered", {
      path: "/tmp/app.duckdb",
      params: {
        table: "users",
        filters: [],
        search_term: null,
        search_columns: [],
        sort_column: null,
        sort_direction: "ASC",
        page_size: 500,
        offset: 0,
      },
    });
  });

  it("keeps stale table selections from replacing newer table metadata", async () => {
    const staleSchema = deferred<ColumnInfo[]>();
    const ordersMeta: ColumnInfo[] = [
      { name: "order_id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
      { name: "total", type: "NUMERIC", notnull: false, default_value: null, primary_key: false },
    ];

    mockInvokeDatabaseProvider
      .mockReturnValueOnce(staleSchema.promise)
      .mockResolvedValueOnce(ordersMeta)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(filteredResult("Current order"));

    const store = createSqlStore("postgres", "connection");
    store.setState({
      connectionId: "postgres-local",
      tables: [
        { name: "users", kind: "table" },
        { name: "orders", kind: "table" },
      ],
      selectedTable: "users",
      selectedObjectKind: "table",
      tableMeta,
      queryResult: { columns: ["id", "name"], rows: [[1, "Initial"]] },
    });

    const firstSelect = store.getState().actions.selectTable("users");
    const secondSelect = store.getState().actions.selectTable("orders");

    await secondSelect;

    expect(store.getState().selectedTable).toBe("orders");
    expect(store.getState().tableMeta).toEqual(ordersMeta);
    expect(store.getState().queryResult?.rows).toEqual([[1, "Current order"]]);

    staleSchema.resolve([
      { name: "stale_id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
    ]);
    await firstSelect;
    await flushPromises();

    expect(store.getState().selectedTable).toBe("orders");
    expect(store.getState().tableMeta).toEqual(ordersMeta);
    expect(store.getState().queryResult?.rows).toEqual([[1, "Current order"]]);
  });

  it("keeps pending refresh responses from restoring state after reset", async () => {
    const refreshRequest = deferred<FilteredQueryResult>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(refreshRequest.promise);

    const store = createReadyStore();

    store.getState().actions.setSearchTerm("alice");
    store.getState().actions.reset();

    refreshRequest.resolve(filteredResult("Alice"));
    await flushPromises();

    expect(store.getState().databasePath).toBeNull();
    expect(store.getState().selectedTable).toBeNull();
    expect(store.getState().queryResult).toBeNull();
    expect(store.getState().isLoading).toBe(false);
  });

  it("does not clear table data when a custom query fails", async () => {
    const store = createReadyStore();
    const existingResult = store.getState().queryResult;
    mockInvokeDatabaseProvider.mockRejectedValueOnce(
      "thread 'main' panicked at duckdb/src/raw_statement.rs:86:21: The statement was not executed yet note: run with `RUST_BACKTRACE=1` environment variable",
    );

    store.getState().actions.setCustomQuery("select * from missing");
    await store.getState().actions.executeCustomQuery();

    expect(store.getState().queryResult).toBe(existingResult);
    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().isCustomQueryLoading).toBe(false);
    expect(store.getState().error).toBe(
      "Query error: The database provider failed while reading the query result. Please retry the query or reopen the database.",
    );
  });

  it("runs an override query and records execution time", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(100).mockReturnValueOnce(147);
    mockInvokeDatabaseProvider.mockResolvedValueOnce({ columns: ["value"], rows: [[2]] });

    const store = createReadyStore();
    store.getState().actions.setCustomQuery("select * from users");

    await store.getState().actions.executeCustomQuery("select 2");

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("query_duckdb", {
      path: "/tmp/app.duckdb",
      query: "select 2",
    });
    expect(store.getState().queryResult).toEqual({ columns: ["value"], rows: [[2]] });
    expect(store.getState().sqlHistory[0]).toBe("select 2");
    expect(store.getState().lastQueryExecutionMs).toBe(47);
  });

  it("paginates custom query results without re-running the query", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1], [2], [3]],
    });

    const store = createReadyStore();
    store.setState({ pageSize: 2 });

    await store.getState().actions.executeCustomQuery("select id from users");

    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(2);

    store.getState().actions.setCurrentPage(2);
    store.getState().actions.setPageSize(1);

    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(3);
    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
  });

  it("clears stale custom query errors when paging existing query results", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1], [2], [3]],
    });

    const store = createReadyStore();
    store.setState({ pageSize: 2 });

    await store.getState().actions.executeCustomQuery("select id from users");
    store.setState({ error: "Query error: syntax error" });

    store.getState().actions.setCurrentPage(2);

    expect(store.getState().currentPage).toBe(2);
    expect(store.getState().error).toBeNull();

    store.setState({ error: "Query error: syntax error" });
    store.getState().actions.setPageSize(1);

    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(3);
    expect(store.getState().error).toBeNull();
    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
  });

  it("paginates custom query results outside table object context", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1], [2], [3]],
    });

    const store = createReadyStore();
    store.setState({ selectedObjectKind: "view", pageSize: 2 });

    await store.getState().actions.executeCustomQuery("select id from users");

    store.getState().actions.setCurrentPage(2);
    expect(store.getState().currentPage).toBe(2);

    store.getState().actions.setPageSize(1);
    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(3);
    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
  });

  it("normalizes malformed custom query result envelopes", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      columns: ["id", 123, "name"],
      rows: [[1, "Ada"], "not a row", [2, "Linus"]],
    });

    const store = createReadyStore();

    await store.getState().actions.executeCustomQuery("select id, name from users");

    expect(store.getState().queryResult).toEqual({
      columns: ["id", "name"],
      rows: [
        [1, "Ada"],
        [2, "Linus"],
      ],
    });
    expect(store.getState().totalPages).toBe(1);
  });

  it("falls back to an empty result for malformed custom query responses", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(["not an envelope"]);

    const store = createReadyStore();

    await store.getState().actions.executeCustomQuery("select broken");

    expect(store.getState().queryResult).toEqual({ columns: [], rows: [] });
    expect(store.getState().totalPages).toBe(1);
  });

  it("keeps stale custom query responses from replacing newer results", async () => {
    const first = deferred<QueryResult>();
    const second = deferred<QueryResult>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const store = createReadyStore();

    const firstPromise = store.getState().actions.executeCustomQuery("select 1");
    const secondPromise = store.getState().actions.executeCustomQuery("select 2");

    second.resolve({ columns: ["value"], rows: [[2]] });
    await secondPromise;
    await flushPromises();

    expect(store.getState().queryResult).toEqual({ columns: ["value"], rows: [[2]] });
    expect(store.getState().isCustomQueryLoading).toBe(false);

    first.resolve({ columns: ["value"], rows: [[1]] });
    await firstPromise;
    await flushPromises();

    expect(store.getState().queryResult).toEqual({ columns: ["value"], rows: [[2]] });
    expect(store.getState().sqlHistory).toEqual(["select 2"]);
  });

  it("ignores custom query results after cancelling the query", async () => {
    const request = deferred<QueryResult>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(request.promise);

    const store = createReadyStore();
    const existingResult = store.getState().queryResult;

    const query = store.getState().actions.executeCustomQuery("select slow");
    expect(store.getState().isCustomQueryLoading).toBe(true);

    store.getState().actions.cancelCustomQuery();

    expect(store.getState().isCustomQuery).toBe(true);
    expect(store.getState().isCustomQueryLoading).toBe(false);

    request.resolve({ columns: ["value"], rows: [["stale"]] });
    await query;
    await flushPromises();

    expect(store.getState().queryResult).toBe(existingResult);
    expect(store.getState().sqlHistory).toEqual([]);
  });

  it("ignores custom query errors after cancelling the query", async () => {
    const request = deferred<QueryResult>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(request.promise);

    const store = createReadyStore();
    const existingResult = store.getState().queryResult;

    const query = store.getState().actions.executeCustomQuery("select slow");
    store.getState().actions.cancelCustomQuery();

    request.reject(new Error("cancelled query failed later"));
    await query;
    await flushPromises();

    expect(store.getState().queryResult).toBe(existingResult);
    expect(store.getState().error).toBeNull();
    expect(store.getState().isCustomQueryLoading).toBe(false);
    expect(store.getState().sqlHistory).toEqual([]);
  });

  it("moves repeated custom queries to the top of history", async () => {
    mockInvokeDatabaseProvider.mockResolvedValue({ columns: ["value"], rows: [[1]] });

    const store = createReadyStore();
    store.setState({ sqlHistory: ["select 1", "select 2", "select 3"] });

    await store.getState().actions.executeCustomQuery("select 2");

    expect(store.getState().sqlHistory).toEqual(["select 2", "select 1", "select 3"]);
  });

  it("removes and clears custom query history", () => {
    const store = createReadyStore();
    store.setState({ sqlHistory: ["select 1", "select 2"] });

    store.getState().actions.removeSqlHistoryEntry("select 1");
    expect(store.getState().sqlHistory).toEqual(["select 2"]);

    store.getState().actions.clearSqlHistory();
    expect(store.getState().sqlHistory).toEqual([]);
  });

  it("promotes selected history entries without executing them", () => {
    const store = createReadyStore();
    store.setState({ sqlHistory: ["select 1", "select 2", "select 3"] });

    store.getState().actions.useSqlHistoryEntry("select 3");

    expect(store.getState().sqlHistory).toEqual(["select 3", "select 1", "select 2"]);
    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
  });

  it("loads saved SQL history for the initialized connection", async () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(
      getSqlHistoryStorageKey("mysql", "connection", "mysql-local"),
      JSON.stringify(["select 1", "select 2"]),
    );
    mockInvokeDatabaseProvider.mockResolvedValueOnce([]);

    const store = createSqlStore("mysql", "connection");

    await store.getState().actions.init("mysql-local");

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("get_mysql_tables", {
      connectionId: "mysql-local",
    });
    expect(store.getState().sqlHistory).toEqual(["select 1", "select 2"]);
  });

  it("clears stale selected table state when initializing an empty database", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce([]);

    const store = createReadyStore();
    store.setState({
      tables: [{ name: "users", kind: "table" }],
      currentPage: 4,
      totalPages: 6,
      searchTerm: "alice",
      columnFilters: [{ column: "name", operator: "contains", value: "ali" }],
      sortColumn: "name",
      sortDirection: "desc",
      isCustomQuery: true,
      customQuery: "select * from users",
      lastQueryExecutionMs: 15,
    });

    const initPromise = store.getState().actions.init("/tmp/empty.duckdb");

    expect(store.getState().selectedTable).toBeNull();
    expect(store.getState().queryResult).toBeNull();
    expect(store.getState().tables).toEqual([]);
    expect(store.getState().customQuery).toBe("");

    await initPromise;

    expect(store.getState().databasePath).toBe("/tmp/empty.duckdb");
    expect(store.getState().tables).toEqual([]);
    expect(store.getState().selectedTable).toBeNull();
    expect(store.getState().queryResult).toBeNull();
    expect(store.getState().tableMeta).toEqual([]);
    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(1);
    expect(store.getState().searchTerm).toBe("");
    expect(store.getState().columnFilters).toEqual([]);
    expect(store.getState().sortColumn).toBeNull();
    expect(store.getState().sortDirection).toBe("asc");
    expect(store.getState().isCustomQuery).toBe(false);
    expect(store.getState().customQuery).toBe("");
    expect(store.getState().lastQueryExecutionMs).toBeNull();
    expect(store.getState().isLoading).toBe(false);
  });

  it("saves SQL history changes for the active connection", async () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    mockInvokeDatabaseProvider.mockResolvedValueOnce({ columns: ["value"], rows: [[1]] });

    const store = createReadyMySqlStore();

    await store.getState().actions.executeCustomQuery("select 1");

    const storageKey = getSqlHistoryStorageKey("mysql", "connection", "mysql-local");
    expect(JSON.parse(storage.getItem(storageKey) ?? "[]")).toEqual(["select 1"]);

    store.getState().actions.removeSqlHistoryEntry("select 1");

    expect(storage.getItem(storageKey)).toBeNull();
  });

  it("clears stale custom query errors when leaving query mode", () => {
    const store = createReadyStore();
    store.setState({
      isCustomQuery: true,
      isCustomQueryLoading: true,
      error: "Query error: syntax error",
    });
    mockInvokeDatabaseProvider.mockResolvedValueOnce(filteredResult("Refreshed"));

    store.getState().actions.setIsCustomQuery(false);

    expect(store.getState().isCustomQuery).toBe(false);
    expect(store.getState().isCustomQueryLoading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("clears table pagination and filter state when entering custom query mode", () => {
    const store = createReadyStore();
    store.setState({
      currentPage: 3,
      totalPages: 8,
      searchTerm: "alice",
      columnFilters: [{ column: "name", operator: "contains", value: "ali" }],
      sortColumn: "name",
      sortDirection: "desc",
    });

    store.getState().actions.setIsCustomQuery(true);

    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(1);
    expect(store.getState().searchTerm).toBe("");
    expect(store.getState().columnFilters).toEqual([]);
    expect(store.getState().sortColumn).toBeNull();
    expect(store.getState().sortDirection).toBe("asc");
  });

  it("ignores invalid column filter indexes", () => {
    mockInvokeDatabaseProvider.mockResolvedValue(filteredResult("Refreshed"));
    const store = createReadyStore();
    store.setState({
      currentPage: 3,
      columnFilters: [{ column: "name", operator: "contains", value: "ali" }],
    });

    store.getState().actions.updateColumnFilter(1, { value: "bob" });
    store.getState().actions.removeColumnFilter(-1);

    expect(store.getState().currentPage).toBe(3);
    expect(store.getState().columnFilters).toEqual([
      { column: "name", operator: "contains", value: "ali" },
    ]);
    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
  });

  it("clears stale column filter values when operators stop using them", () => {
    mockInvokeDatabaseProvider.mockResolvedValue(filteredResult("Refreshed"));
    const store = createReadyStore();
    store.setState({
      columnFilters: [{ column: "deleted_at", operator: "between", value: "1", value2: "2" }],
    });

    store.getState().actions.updateColumnFilter(0, { operator: "isNull" });

    expect(store.getState().columnFilters).toEqual([
      { column: "deleted_at", operator: "isNull", value: "", value2: undefined },
    ]);

    store.getState().actions.updateColumnFilter(0, { operator: "equals", value: "active" });

    expect(store.getState().columnFilters).toEqual([
      { column: "deleted_at", operator: "equals", value: "active", value2: undefined },
    ]);
  });

  it("updates cells by row values when a table has no primary key", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(filteredResult("Alice Updated"));

    const store = createNoPrimaryKeyStore();

    await store.getState().actions.updateCell(0, "name", "Alice Updated");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "update_duckdb_row_by_values", {
      path: "/tmp/app.duckdb",
      table: "users",
      setColumns: ["name"],
      setValues: ["Alice Updated"],
      identity: {
        columns: ["name", "email"],
        values: ["Alice", null],
      },
    });
  });

  it("sets loading state while row mutations are pending and clears it on failure", async () => {
    const insert = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(insert.promise);

    const store = createReadyStore();
    const mutation = store.getState().actions.insertRow({ name: "Alice" });

    expect(store.getState().isLoading).toBe(true);
    expect(store.getState().error).toBeNull();

    insert.reject(new Error("constraint failed"));
    await mutation;

    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBe("Insert failed: constraint failed");
  });

  it("does not refresh a stale row mutation after table selection changes", async () => {
    const insert = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(insert.promise);

    const store = createReadyStore();
    const mutation = store.getState().actions.insertRow({ name: "Alice" });
    store.setState({
      selectedTable: "events",
      queryResult: filteredResult("Event"),
      isLoading: false,
    });

    insert.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(store.getState().selectedTable).toBe("events");
    expect(store.getState().queryResult?.rows).toEqual([[1, "Event"]]);
  });

  it("does not report stale row mutation errors after table selection changes", async () => {
    const insert = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(insert.promise);

    const store = createReadyStore();
    const mutation = store.getState().actions.insertRow({ name: "Alice" });
    store.setState({
      selectedTable: "events",
      queryResult: filteredResult("Event"),
      isLoading: false,
      error: null,
    });

    insert.reject(new Error("constraint failed"));
    await mutation;
    await flushPromises();

    expect(store.getState().selectedTable).toBe("events");
    expect(store.getState().queryResult?.rows).toEqual([[1, "Event"]]);
    expect(store.getState().error).toBeNull();
  });

  it("updates and deletes rows by row values when a table has no primary key", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(filteredResult("Alice Updated"))
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(filteredResult("Remaining"));

    const store = createNoPrimaryKeyStore();
    const rowData = { name: "Alice", email: null };

    await store.getState().actions.updateRowByValues(rowData, {
      name: "Alice Updated",
      email: null,
    });

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "update_duckdb_row_by_values", {
      path: "/tmp/app.duckdb",
      table: "users",
      setColumns: ["name", "email"],
      setValues: ["Alice Updated", null],
      identity: {
        columns: ["name", "email"],
        values: ["Alice", null],
      },
    });

    await store.getState().actions.deleteRowByValues(rowData);

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(3, "delete_duckdb_row_by_values", {
      path: "/tmp/app.duckdb",
      table: "users",
      identity: {
        columns: ["name", "email"],
        values: ["Alice", null],
      },
    });
  });

  it("updates cells by row values when the primary key value is missing", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(1).mockResolvedValueOnce({
      columns: ["id", "name"],
      rows: [[null, "Alice Updated"]],
      total_count: 1,
    });

    const store = createReadyStore();
    store.setState({
      queryResult: {
        columns: ["id", "name"],
        rows: [[null, "Alice"]],
      },
    });

    await store.getState().actions.updateCell(0, "name", "Alice Updated");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "update_duckdb_row_by_values", {
      path: "/tmp/app.duckdb",
      table: "users",
      setColumns: ["name"],
      setValues: ["Alice Updated"],
      identity: {
        columns: ["id", "name"],
        values: [null, "Alice"],
      },
    });
  });

  it("ignores custom query results after returning to table mode", async () => {
    const customRequest = deferred<QueryResult>();
    const refreshRequest = deferred<FilteredQueryResult>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(customRequest.promise)
      .mockReturnValueOnce(refreshRequest.promise);

    const store = createReadyStore();

    store.getState().actions.setCustomQuery("select 1");
    const customPromise = store.getState().actions.executeCustomQuery();
    store.getState().actions.setIsCustomQuery(false);

    customRequest.resolve({ columns: ["value"], rows: [[1]] });
    await customPromise;
    await flushPromises();

    expect(store.getState().isCustomQuery).toBe(false);
    expect(store.getState().queryResult?.columns).toEqual(["id", "name"]);

    refreshRequest.resolve(filteredResult("Refreshed"));
    await flushPromises();

    expect(store.getState().queryResult?.rows).toEqual([[1, "Refreshed"]]);
  });

  it("drops views with DROP VIEW instead of DROP TABLE", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: "users", kind: "table" }]);

    const store = createReadyStore();
    store.setState({
      tables: [
        { name: "users", kind: "table" },
        { name: "active_users", kind: "view" },
      ],
      selectedTable: "users",
    });

    await store.getState().actions.dropTable("active_users");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "execute_duckdb", {
      path: "/tmp/app.duckdb",
      statement: 'DROP VIEW "active_users"',
    });
    expect(store.getState().isLoading).toBe(false);
  });

  it("sets loading state while table mutations are pending and clears it on failure", async () => {
    const create = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(create.promise);

    const store = createReadyStore();
    const mutation = store
      .getState()
      .actions.createTable("new_users", [{ name: "id", type: "INTEGER", notnull: true }]);

    expect(store.getState().isLoading).toBe(true);
    expect(store.getState().error).toBeNull();

    create.reject(new Error("syntax error"));
    await mutation;

    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBe("Create table failed: syntax error");
  });

  it("does not refresh a stale table mutation after connection changes", async () => {
    const create = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(create.promise);

    const store = createReadyStore();
    const mutation = store
      .getState()
      .actions.createTable("new_users", [{ name: "id", type: "INTEGER", notnull: true }]);
    store.setState({
      databasePath: "/tmp/other.duckdb",
      tables: [{ name: "events", kind: "table" }],
      selectedTable: "events",
      isLoading: false,
    });

    create.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(store.getState().databasePath).toBe("/tmp/other.duckdb");
    expect(store.getState().tables).toEqual([{ name: "events", kind: "table" }]);
    expect(store.getState().selectedTable).toBe("events");
  });

  it("does not auto-select a created table after selection changes", async () => {
    const create = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(create.promise).mockResolvedValueOnce([
      { name: "users", kind: "table" },
      { name: "events", kind: "table" },
      { name: "new_users", kind: "table" },
    ]);

    const store = createReadyStore();
    const mutation = store
      .getState()
      .actions.createTable("new_users", [{ name: "id", type: "INTEGER", notnull: true }]);
    store.setState({
      selectedTable: "events",
      queryResult: filteredResult("Event"),
      isLoading: false,
    });

    create.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(2);
    expect(store.getState().selectedTable).toBe("events");
    expect(store.getState().queryResult?.rows).toEqual([[1, "Event"]]);
    expect(store.getState().isLoading).toBe(false);
  });

  it("does not switch tables after a dropped table is no longer selected", async () => {
    const drop = deferred<unknown>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(drop.promise)
      .mockResolvedValueOnce([{ name: "events", kind: "table" }]);

    const store = createReadyStore();
    const mutation = store.getState().actions.dropTable("users");
    store.setState({
      selectedTable: "events",
      queryResult: filteredResult("Event"),
      isLoading: false,
    });

    drop.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(2);
    expect(store.getState().tables).toEqual([{ name: "events", kind: "table" }]);
    expect(store.getState().selectedTable).toBe("events");
    expect(store.getState().queryResult?.rows).toEqual([[1, "Event"]]);
  });

  it("clears stale table view state after dropping the last selected object", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);

    const store = createReadyStore();
    store.setState({
      currentPage: 3,
      totalPages: 6,
      searchTerm: "alice",
      columnFilters: [{ column: "name", operator: "contains", value: "ali" }],
      sortColumn: "name",
      sortDirection: "desc",
      isCustomQuery: true,
      isCustomQueryLoading: true,
      lastQueryExecutionMs: 12,
    });

    await store.getState().actions.dropTable("users");

    expect(store.getState().selectedTable).toBeNull();
    expect(store.getState().queryResult).toBeNull();
    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(1);
    expect(store.getState().searchTerm).toBe("");
    expect(store.getState().columnFilters).toEqual([]);
    expect(store.getState().sortColumn).toBeNull();
    expect(store.getState().sortDirection).toBe("asc");
    expect(store.getState().isCustomQuery).toBe(false);
    expect(store.getState().isCustomQueryLoading).toBe(false);
    expect(store.getState().lastQueryExecutionMs).toBeNull();
    expect(store.getState().isLoading).toBe(false);
  });

  it("does not report stale table mutation errors after connection changes", async () => {
    const create = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(create.promise);

    const store = createReadyStore();
    const mutation = store
      .getState()
      .actions.createTable("new_users", [{ name: "id", type: "INTEGER", notnull: true }]);
    store.setState({
      databasePath: "/tmp/other.duckdb",
      tables: [{ name: "events", kind: "table" }],
      selectedTable: "events",
      isLoading: false,
      error: null,
    });

    create.reject(new Error("syntax error"));
    await mutation;
    await flushPromises();

    expect(store.getState().databasePath).toBe("/tmp/other.duckdb");
    expect(store.getState().tables).toEqual([{ name: "events", kind: "table" }]);
    expect(store.getState().selectedTable).toBe("events");
    expect(store.getState().error).toBeNull();
  });

  it("sets loading state while subscription mutations are pending and clears it on failure", async () => {
    const create = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(create.promise);

    const store = createSqlStore("postgres", "connection");
    store.setState({ connectionId: "postgres-local" });
    const mutation = store.getState().actions.createSubscription({
      name: "sub_users",
      connection_string: "host=localhost dbname=source",
      publications: ["pub_all"],
      enabled: true,
      create_slot: true,
      copy_data: true,
      connect: true,
      failover: false,
    });

    expect(store.getState().isLoading).toBe(true);
    expect(store.getState().error).toBeNull();

    create.reject(new Error("replication slot exists"));
    await mutation;

    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBe("Create subscription failed: replication slot exists");
  });

  it("clears loading state after dropping an unselected subscription", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(undefined).mockResolvedValueOnce([
      { name: "users", kind: "table" },
      { name: "sub_events", kind: "subscription" },
    ]);

    const store = createSqlStore("postgres", "connection");
    store.setState({
      connectionId: "postgres-local",
      selectedTable: "users",
      tables: [
        { name: "users", kind: "table" },
        { name: "sub_events", kind: "subscription" },
      ],
    });

    await store.getState().actions.dropSubscription("sub_events", true);

    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().error).toBeNull();
  });

  it("clears stale subscription view state after dropping the last selected subscription", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);

    const store = createSqlStore("postgres", "connection");
    store.setState({
      connectionId: "postgres-local",
      selectedTable: "sub_events",
      selectedObjectKind: "subscription",
      tables: [{ name: "sub_events", kind: "subscription" }],
      queryResult: { columns: ["relation"], rows: [["users"]] },
      tableMeta: [
        { name: "relation", type: "text", notnull: false, default_value: null, primary_key: true },
      ],
      subscriptionInfo: {
        name: "sub_events",
        owner: "postgres",
        enabled: true,
        publications: ["pub_all"],
        connection_string: "host=localhost dbname=source",
        slot_name: "sub_events",
        synchronous_commit: null,
        binary: false,
        streaming: null,
        two_phase: false,
        disable_on_error: false,
        password_required: false,
        run_as_owner: false,
        origin: null,
        failover: false,
        two_phase_state: null,
      },
      currentPage: 2,
      totalPages: 4,
      searchTerm: "events",
      sortColumn: "relation",
      sortDirection: "desc",
    });

    await store.getState().actions.dropSubscription("sub_events", true);

    expect(store.getState().selectedTable).toBeNull();
    expect(store.getState().selectedObjectKind).toBe("table");
    expect(store.getState().queryResult).toBeNull();
    expect(store.getState().tableMeta).toEqual([]);
    expect(store.getState().subscriptionInfo).toBeNull();
    expect(store.getState().currentPage).toBe(1);
    expect(store.getState().totalPages).toBe(1);
    expect(store.getState().searchTerm).toBe("");
    expect(store.getState().sortColumn).toBeNull();
    expect(store.getState().sortDirection).toBe("asc");
    expect(store.getState().isLoading).toBe(false);
  });

  it("drops indexes with DROP INDEX instead of DROP TABLE", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: "users", kind: "table" }]);

    const store = createReadyStore();
    store.setState({
      tables: [
        { name: "users", kind: "table" },
        { name: "users_name_idx", kind: "index" },
      ],
      selectedTable: "users",
    });

    await store.getState().actions.dropTable("users_name_idx");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "execute_duckdb", {
      path: "/tmp/app.duckdb",
      statement: 'DROP INDEX "users_name_idx"',
    });
  });

  it("drops materialized views with DROP MATERIALIZED VIEW", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: "users", kind: "table" }]);

    const store = createReadyPostgresStore();
    store.setState({
      tables: [
        { name: "users", kind: "table" },
        { name: "daily_metrics", kind: "materialized_view" },
      ],
      selectedTable: "users",
    });

    await store.getState().actions.dropTable("daily_metrics");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "execute_postgres", {
      connectionId: "pg-local",
      statement: 'DROP MATERIALIZED VIEW "daily_metrics"',
    });
  });

  it("drops MySQL indexes with their owning table", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ name: "users", kind: "table" }]);

    const store = createReadyMySqlStore();
    store.setState({
      tables: [
        { name: "users", kind: "table" },
        { name: "users_name_idx", kind: "index", table_name: "users" },
      ],
      selectedTable: "users",
    });

    await store.getState().actions.dropTable("users_name_idx");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "execute_mysql", {
      connectionId: "mysql-local",
      statement: "DROP INDEX `users_name_idx` ON `users`",
    });
  });
});
