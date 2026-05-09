import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { useMongoDbStore } from "./mongodb-store";

vi.mock("@/features/database/services/database-provider-sidecar", () => ({
  invokeDatabaseProvider: vi.fn(),
}));

const mockInvokeDatabaseProvider = vi.mocked(invokeDatabaseProvider);

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

function setReadyMongoState() {
  useMongoDbStore.setState({
    connectionId: "mongo-prod",
    selectedDatabase: "app",
    selectedCollection: "users",
    documents: [{ _id: "existing", name: "Existing" }],
    totalCount: 1,
    totalPages: 1,
    pageSize: 50,
    currentPage: 1,
    filterJson: "{}",
    sortJson: "{}",
    isLoading: false,
    error: null,
  });
}

describe("mongodb store reliability", () => {
  beforeEach(() => {
    mockInvokeDatabaseProvider.mockReset();
    useMongoDbStore.getState().actions.reset();
    setReadyMongoState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useMongoDbStore.getState().actions.reset();
  });

  it("keeps stale refresh responses from replacing newer documents", async () => {
    const first = deferred<{ documents: Record<string, unknown>[]; total_count: number }>();
    const second = deferred<{ documents: Record<string, unknown>[]; total_count: number }>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    useMongoDbStore.getState().actions.setCurrentPage(2);
    useMongoDbStore.getState().actions.setPageSize(25);

    second.resolve({ documents: [{ _id: "newer", name: "Newer" }], total_count: 25 });
    await flushPromises();

    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "newer", name: "Newer" }]);
    expect(useMongoDbStore.getState().isLoading).toBe(false);

    first.resolve({ documents: [{ _id: "stale", name: "Stale" }], total_count: 100 });
    await flushPromises();

    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "newer", name: "Newer" }]);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
  });

  it("clears stale collection state when initializing a new connection", async () => {
    const databases = deferred<string[]>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(databases.promise);
    useMongoDbStore.setState({
      databases: ["old"],
      selectedDatabase: "old",
      collections: [{ name: "old_users" }],
      selectedCollection: "old_users",
      documents: [{ _id: "old", name: "Old" }],
      totalCount: 1,
      totalPages: 4,
      currentPage: 3,
      filterJson: '{"stale":true}',
      sortJson: '{"createdAt":-1}',
    });

    void useMongoDbStore.getState().actions.init("mongo-dev");

    expect(useMongoDbStore.getState().connectionId).toBe("mongo-dev");
    expect(useMongoDbStore.getState().databases).toEqual([]);
    expect(useMongoDbStore.getState().selectedDatabase).toBeNull();
    expect(useMongoDbStore.getState().collections).toEqual([]);
    expect(useMongoDbStore.getState().selectedCollection).toBeNull();
    expect(useMongoDbStore.getState().documents).toEqual([]);
    expect(useMongoDbStore.getState().totalCount).toBe(0);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
    expect(useMongoDbStore.getState().currentPage).toBe(1);
    expect(useMongoDbStore.getState().filterJson).toBe("{}");
    expect(useMongoDbStore.getState().sortJson).toBe("{}");

    databases.resolve([]);
    await flushPromises();
  });

  it("normalizes database names returned during init", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce([" app ", "", "app", 42])
      .mockResolvedValueOnce([]);

    await useMongoDbStore.getState().actions.init("mongo-dev");

    expect(useMongoDbStore.getState().databases).toEqual(["app"]);
    expect(useMongoDbStore.getState().selectedDatabase).toBe("app");
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "get_mongo_collections", {
      connectionId: "mongo-dev",
      database: "app",
    });
  });

  it("clamps requested pages before refreshing", async () => {
    useMongoDbStore.setState({ totalPages: 3, pageSize: 25 });
    mockInvokeDatabaseProvider.mockResolvedValue({ documents: [], total_count: 75 });

    useMongoDbStore.getState().actions.setCurrentPage(99);
    await flushPromises();

    expect(useMongoDbStore.getState().currentPage).toBe(3);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 25,
      skip: 50,
    });

    useMongoDbStore.getState().actions.setCurrentPage(0);
    await flushPromises();

    expect(useMongoDbStore.getState().currentPage).toBe(1);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 25,
      skip: 0,
    });
  });

  it("normalizes page size before refreshing", async () => {
    mockInvokeDatabaseProvider.mockResolvedValue({ documents: [], total_count: 0 });

    useMongoDbStore.getState().actions.setPageSize(0);
    await flushPromises();

    expect(useMongoDbStore.getState().pageSize).toBe(1);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 1,
      skip: 0,
    });

    useMongoDbStore.getState().actions.setPageSize(999);
    await flushPromises();

    expect(useMongoDbStore.getState().pageSize).toBe(500);
    expect(mockInvokeDatabaseProvider).toHaveBeenLastCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 500,
      skip: 0,
    });
  });

  it("refetches the last valid page when refresh results shrink below the current page", async () => {
    useMongoDbStore.setState({ currentPage: 3, pageSize: 25, totalPages: 3 });
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce({ documents: [], total_count: 40 })
      .mockResolvedValueOnce({ documents: [{ _id: "last", name: "Last" }], total_count: 40 });

    await useMongoDbStore.getState().actions.refresh();

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 25,
      skip: 50,
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 25,
      skip: 25,
    });
    expect(useMongoDbStore.getState().currentPage).toBe(2);
    expect(useMongoDbStore.getState().totalPages).toBe(2);
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "last", name: "Last" }]);
  });

  it("does not issue a stale page refetch after a newer refresh starts", async () => {
    const stale = deferred<{ documents: Record<string, unknown>[]; total_count: number }>();
    const current = deferred<{ documents: Record<string, unknown>[]; total_count: number }>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    useMongoDbStore.setState({ currentPage: 3, pageSize: 25, totalPages: 3 });
    const staleRefresh = useMongoDbStore.getState().actions.refresh();
    useMongoDbStore.getState().actions.setPageSize(50);

    current.resolve({ documents: [{ _id: "current", name: "Current" }], total_count: 40 });
    await flushPromises();

    stale.resolve({ documents: [], total_count: 40 });
    await staleRefresh;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(2);
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "current", name: "Current" }]);
    expect(useMongoDbStore.getState().pageSize).toBe(50);
  });

  it("keeps existing documents when a refresh fails", async () => {
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("bad filter"));

    await useMongoDbStore.getState().actions.refresh();

    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "existing", name: "Existing" }]);
    expect(useMongoDbStore.getState().isLoading).toBe(false);
    expect(useMongoDbStore.getState().error).toBe("Query failed: bad filter");
  });

  it("refreshes documents when filter or sort JSON changes", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce({ documents: [{ _id: "filtered", name: "Filtered" }], total_count: 1 })
      .mockResolvedValueOnce({ documents: [{ _id: "sorted", name: "Sorted" }], total_count: 1 });

    useMongoDbStore.getState().actions.setFilterJson('{"name":"Filtered"}');
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: '{"name":"Filtered"}',
      sortJson: "{}",
      limit: 50,
      skip: 0,
    });
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "filtered", name: "Filtered" }]);

    useMongoDbStore.getState().actions.setSortJson('{"name":1}');
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: '{"name":"Filtered"}',
      sortJson: '{"name":1}',
      limit: 50,
      skip: 0,
    });
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "sorted", name: "Sorted" }]);
  });

  it("applies filter and sort JSON with one refresh", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      documents: [{ _id: "combined", name: "Combined" }],
      total_count: 1,
    });

    useMongoDbStore.getState().actions.setQueryJson('{"name":"Combined"}', '{"createdAt":-1}');
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: '{"name":"Combined"}',
      sortJson: '{"createdAt":-1}',
      limit: 50,
      skip: 0,
    });
    expect(useMongoDbStore.getState().filterJson).toBe('{"name":"Combined"}');
    expect(useMongoDbStore.getState().sortJson).toBe('{"createdAt":-1}');
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "combined", name: "Combined" }]);
  });

  it("treats blank filter and sort JSON as empty query objects", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      documents: [{ _id: "all", name: "All" }],
      total_count: 1,
    });

    useMongoDbStore.getState().actions.setQueryJson("   ", "\n");
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 50,
      skip: 0,
    });
    expect(useMongoDbStore.getState().filterJson).toBe("{}");
    expect(useMongoDbStore.getState().sortJson).toBe("{}");
  });

  it("rejects invalid MongoDB query JSON before invoking the provider", async () => {
    useMongoDbStore.getState().actions.setQueryJson("{bad", "{}");
    await flushPromises();

    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
    expect(useMongoDbStore.getState().filterJson).toBe("{bad");
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "existing", name: "Existing" }]);
    expect(useMongoDbStore.getState().error).toBe("Invalid MongoDB filter JSON");
    expect(useMongoDbStore.getState().isLoading).toBe(false);
  });

  it("rejects non-object MongoDB query JSON before invoking the provider", async () => {
    useMongoDbStore.getState().actions.setQueryJson("{}", "[]");
    await flushPromises();

    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
    expect(useMongoDbStore.getState().sortJson).toBe("[]");
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "existing", name: "Existing" }]);
    expect(useMongoDbStore.getState().error).toBe("MongoDB sort JSON must be an object");
  });

  it("keeps stale MongoDB refreshes from replacing documents after invalid query JSON", async () => {
    const stale = deferred<{ documents: Record<string, unknown>[]; total_count: number }>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(stale.promise);

    const refresh = useMongoDbStore.getState().actions.refresh();
    useMongoDbStore.getState().actions.setQueryJson("{bad", "{}");

    expect(useMongoDbStore.getState().error).toBe("Invalid MongoDB filter JSON");

    stale.resolve({ documents: [{ _id: "stale", name: "Stale" }], total_count: 1 });
    await refresh;
    await flushPromises();

    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "existing", name: "Existing" }]);
    expect(useMongoDbStore.getState().error).toBe("Invalid MongoDB filter JSON");
  });

  it("normalizes invalid total counts from document queries", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      documents: [],
      total_count: Number.NaN,
    });

    await useMongoDbStore.getState().actions.refresh();

    expect(useMongoDbStore.getState().totalCount).toBe(0);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
  });

  it("normalizes malformed document query results", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      documents: [{ _id: "valid" }, null, ["array"], "text"],
      total_count: 4.8,
    });

    await useMongoDbStore.getState().actions.refresh();

    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "valid" }]);
    expect(useMongoDbStore.getState().totalCount).toBe(4);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
  });

  it("falls back to empty documents for malformed document query envelopes", async () => {
    useMongoDbStore.setState({ documents: [{ _id: "existing" }], totalCount: 1 });
    mockInvokeDatabaseProvider.mockResolvedValueOnce(["not an envelope"]);

    await useMongoDbStore.getState().actions.refresh();

    expect(useMongoDbStore.getState().documents).toEqual([]);
    expect(useMongoDbStore.getState().totalCount).toBe(0);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
  });

  it("clears loading state when document mutations fail", async () => {
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("duplicate key"));

    await useMongoDbStore.getState().actions.insertDocument({ name: "Alice" });

    expect(useMongoDbStore.getState().isLoading).toBe(false);
    expect(useMongoDbStore.getState().error).toBe("Insert failed: duplicate key");
  });

  it("does not refresh a stale document mutation after collection changes", async () => {
    const insert = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(insert.promise);

    const mutation = useMongoDbStore.getState().actions.insertDocument({ name: "Alice" });
    useMongoDbStore.setState({
      selectedCollection: "events",
      documents: [{ _id: "event-1", name: "Event" }],
      isLoading: false,
    });

    insert.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(useMongoDbStore.getState().selectedCollection).toBe("events");
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "event-1", name: "Event" }]);
  });

  it("does not report stale document mutation errors after collection changes", async () => {
    const insert = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(insert.promise);

    const mutation = useMongoDbStore.getState().actions.insertDocument({ name: "Alice" });
    useMongoDbStore.setState({
      selectedCollection: "events",
      documents: [{ _id: "event-1", name: "Event" }],
      isLoading: false,
      error: null,
    });

    insert.reject(new Error("duplicate key"));
    await mutation;
    await flushPromises();

    expect(useMongoDbStore.getState().selectedCollection).toBe("events");
    expect(useMongoDbStore.getState().error).toBeNull();
    expect(useMongoDbStore.getState().documents).toEqual([{ _id: "event-1", name: "Event" }]);
  });

  it("keeps stale database selections from replacing newer collections", async () => {
    const first = deferred<{ name: string }[]>();
    const second = deferred<{ name: string }[]>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    void useMongoDbStore.getState().actions.selectDatabase("archive");
    void useMongoDbStore.getState().actions.selectDatabase("app");

    second.resolve([]);
    await flushPromises();

    expect(useMongoDbStore.getState().selectedDatabase).toBe("app");
    expect(useMongoDbStore.getState().collections).toEqual([]);
    expect(useMongoDbStore.getState().documents).toEqual([]);
    expect(useMongoDbStore.getState().isLoading).toBe(false);

    first.resolve([{ name: "stale" }]);
    await flushPromises();

    expect(useMongoDbStore.getState().selectedDatabase).toBe("app");
    expect(useMongoDbStore.getState().collections).toEqual([]);
  });

  it("normalizes collection names before selecting the first collection", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce([{ name: " users " }, { name: "" }, { name: "users" }, "events"])
      .mockResolvedValueOnce({ documents: [], total_count: 0 });

    await useMongoDbStore.getState().actions.selectDatabase("app");

    expect(useMongoDbStore.getState().collections).toEqual([{ name: "users" }, { name: "events" }]);
    expect(useMongoDbStore.getState().selectedCollection).toBe("users");
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 50,
      skip: 0,
    });
  });

  it("normalizes direct database and collection selections", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce([{ name: " users " }])
      .mockResolvedValueOnce({ documents: [], total_count: 0 });

    await useMongoDbStore.getState().actions.selectDatabase(" app ");

    expect(useMongoDbStore.getState().selectedDatabase).toBe("app");
    expect(useMongoDbStore.getState().selectedCollection).toBe("users");
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "get_mongo_collections", {
      connectionId: "mongo-prod",
      database: "app",
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "users",
      filterJson: "{}",
      sortJson: "{}",
      limit: 50,
      skip: 0,
    });

    mockInvokeDatabaseProvider.mockClear();
    useMongoDbStore.getState().actions.selectCollection("   ");

    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
    expect(useMongoDbStore.getState().selectedCollection).toBe("users");

    mockInvokeDatabaseProvider.mockResolvedValueOnce({ documents: [], total_count: 0 });

    await useMongoDbStore.getState().actions.selectCollection(" events ");

    expect(useMongoDbStore.getState().selectedCollection).toBe("events");
    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("query_mongo_documents", {
      connectionId: "mongo-prod",
      database: "app",
      collection: "events",
      filterJson: "{}",
      sortJson: "{}",
      limit: 50,
      skip: 0,
    });
  });

  it("clears stale documents before loading a selected collection", async () => {
    useMongoDbStore.setState({
      selectedCollection: "users",
      documents: [{ _id: "user-1", name: "Ada" }],
      totalCount: 1,
      totalPages: 3,
      currentPage: 2,
      error: "Previous error",
    });
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("collection unavailable"));

    await useMongoDbStore.getState().actions.selectCollection("events");

    expect(useMongoDbStore.getState().selectedCollection).toBe("events");
    expect(useMongoDbStore.getState().documents).toEqual([]);
    expect(useMongoDbStore.getState().totalCount).toBe(0);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
    expect(useMongoDbStore.getState().currentPage).toBe(1);
    expect(useMongoDbStore.getState().error).toBe("Query failed: collection unavailable");
  });

  it("resets stale query state when selecting a database with no collections", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce([]);
    useMongoDbStore.setState({
      currentPage: 4,
      totalPages: 4,
      filterJson: '{"status":"active"}',
      sortJson: '{"createdAt":-1}',
      documents: [{ _id: "stale" }],
      totalCount: 75,
    });

    await useMongoDbStore.getState().actions.selectDatabase("empty");

    expect(useMongoDbStore.getState().selectedDatabase).toBe("empty");
    expect(useMongoDbStore.getState().selectedCollection).toBeNull();
    expect(useMongoDbStore.getState().collections).toEqual([]);
    expect(useMongoDbStore.getState().documents).toEqual([]);
    expect(useMongoDbStore.getState().currentPage).toBe(1);
    expect(useMongoDbStore.getState().totalPages).toBe(1);
    expect(useMongoDbStore.getState().filterJson).toBe("{}");
    expect(useMongoDbStore.getState().sortJson).toBe("{}");
    expect(useMongoDbStore.getState().totalCount).toBe(0);
  });

  it("keeps pending init responses from restoring state after reset", async () => {
    const databases = deferred<string[]>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(databases.promise);
    useMongoDbStore.getState().actions.reset();

    const init = useMongoDbStore.getState().actions.init("mongo-new");
    useMongoDbStore.getState().actions.reset();

    databases.resolve(["app"]);
    await init;
    await flushPromises();

    expect(useMongoDbStore.getState().connectionId).toBeNull();
    expect(useMongoDbStore.getState().fileName).toBe("");
    expect(useMongoDbStore.getState().databases).toEqual([]);
    expect(useMongoDbStore.getState().isLoading).toBe(false);
  });
});
