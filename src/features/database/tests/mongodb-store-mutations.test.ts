import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import {
  createMongoDbStore,
  MONGODB_PROVIDER_COMMANDS,
} from "@/features/database/providers/mongodb/stores/mongodb.store";

vi.mock("@/features/database/services/database-provider-sidecar", () => ({
  invokeDatabaseProvider: vi.fn(),
}));

const invoke = vi.mocked(invokeDatabaseProvider);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function readyStore() {
  const store = createMongoDbStore();
  store.setState({
    connectionId: "mongo-1",
    selectedDatabase: "app",
    selectedCollection: "users",
    documents: [{ _id: "a" }],
    totalCount: 1,
    totalPages: 1,
    currentPage: 1,
    pageSize: 50,
    filterJson: "{}",
    sortJson: "{}",
  });
  return store;
}

function commandCalls(command: string) {
  return invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);
}

beforeEach(() => {
  invoke.mockReset();
});

describe("mongodb document mutations", () => {
  it("inserts, updates and deletes documents, then reloads the collection", async () => {
    invoke.mockImplementation(async (command: string) =>
      command === MONGODB_PROVIDER_COMMANDS.queryDocuments
        ? { documents: [{ _id: "b", name: "Grace" }], total_count: 1 }
        : null,
    );
    const store = readyStore();

    await store.getState().actions.insertDocument({ name: "Grace" });
    await store.getState().actions.updateDocument("b", { $set: { name: "Grace H." } });
    await store.getState().actions.deleteDocument("b");

    expect(commandCalls(MONGODB_PROVIDER_COMMANDS.insertDocument)[0]).toEqual({
      connectionId: "mongo-1",
      database: "app",
      collection: "users",
      documentJson: '{"name":"Grace"}',
    });
    expect(commandCalls(MONGODB_PROVIDER_COMMANDS.updateDocument)[0]).toEqual({
      connectionId: "mongo-1",
      database: "app",
      collection: "users",
      filterJson: '{"_id":"b"}',
      updateJson: '{"$set":{"name":"Grace H."}}',
    });
    expect(commandCalls(MONGODB_PROVIDER_COMMANDS.deleteDocument)[0]).toEqual({
      connectionId: "mongo-1",
      database: "app",
      collection: "users",
      filterJson: '{"_id":"b"}',
    });
    expect(commandCalls(MONGODB_PROVIDER_COMMANDS.queryDocuments)).toHaveLength(3);
    expect(store.getState()).toMatchObject({
      documents: [{ _id: "b", name: "Grace" }],
      isLoading: false,
      error: null,
    });
  });

  it("reports failed mutations", async () => {
    invoke.mockRejectedValue(new Error("not authorized on app"));
    const store = readyStore();

    await store.getState().actions.insertDocument({ name: "x" });
    expect(store.getState().error).toMatch(/^Insert failed/);
    await store.getState().actions.updateDocument("a", {});
    expect(store.getState().error).toMatch(/^Update failed/);
    await store.getState().actions.deleteDocument("a");
    expect(store.getState().error).toMatch(/^Delete failed/);
    expect(store.getState().isLoading).toBe(false);
  });

  it("ignores mutations without a selected collection", async () => {
    const store = createMongoDbStore();

    await store.getState().actions.insertDocument({});
    await store.getState().actions.updateDocument("a", {});
    await store.getState().actions.deleteDocument("a");

    expect(invoke).not.toHaveBeenCalled();
  });

  type ReadyStore = ReturnType<typeof readyStore>;
  const mutations = [
    {
      name: "insertDocument",
      mutate: (store: ReadyStore) => store.getState().actions.insertDocument({}),
    },
    {
      name: "updateDocument",
      mutate: (store: ReadyStore) => store.getState().actions.updateDocument("a", {}),
    },
    {
      name: "deleteDocument",
      mutate: (store: ReadyStore) => store.getState().actions.deleteDocument("a"),
    },
  ];

  it.each(mutations)("drops $name results after the collection changed", async ({ mutate }) => {
    const store = readyStore();
    const pending = deferred<null>();
    const failing = deferred<null>();
    invoke.mockReturnValueOnce(pending.promise).mockReturnValueOnce(failing.promise);

    const success = mutate(store);
    store.setState({ selectedCollection: "orders", error: null });
    pending.resolve(null);
    await success;

    store.setState({ selectedCollection: "users" });
    const failure = mutate(store);
    store.setState({ selectedCollection: "orders", error: null });
    failing.reject(new Error("late"));
    await failure;

    expect(store.getState().error).toBeNull();
    expect(commandCalls(MONGODB_PROVIDER_COMMANDS.queryDocuments)).toHaveLength(0);
  });
});

describe("mongodb browsing", () => {
  it("opens the first database and collection on init", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === MONGODB_PROVIDER_COMMANDS.getDatabases) return ["app", "logs"];
      if (command === MONGODB_PROVIDER_COMMANDS.getCollections) return ["users", "orders"];
      return { documents: [{ _id: "1" }], total_count: 1 };
    });
    const store = createMongoDbStore();

    await store.getState().actions.init("mongo-1");

    expect(store.getState()).toMatchObject({
      databases: ["app", "logs"],
      selectedDatabase: "app",
      selectedCollection: "users",
      documents: [{ _id: "1" }],
      isLoading: false,
    });
  });

  it("reports databases and collections that cannot be listed", async () => {
    invoke.mockRejectedValueOnce(new Error("auth failed"));
    const store = createMongoDbStore();

    await store.getState().actions.init("mongo-1");
    expect(store.getState().error).toMatch(/^Failed to load databases/);
    expect(store.getState().isLoading).toBe(false);

    invoke.mockRejectedValueOnce(new Error("no listCollections"));
    await store.getState().actions.selectDatabase("app");
    expect(store.getState().error).toMatch(/^Failed to load collections/);
    expect(store.getState().isLoading).toBe(false);
  });

  it("treats malformed document responses as empty", async () => {
    invoke.mockResolvedValue("garbage");
    const store = readyStore();

    await store.getState().actions.refresh();

    expect(store.getState()).toMatchObject({ documents: [], totalCount: 0, totalPages: 1 });
  });
});
