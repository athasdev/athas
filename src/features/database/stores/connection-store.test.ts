import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useConnectionStore, type SavedConnection } from "./connection.store";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

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

const postgresConnection: SavedConnection = {
  id: "pg-prod",
  name: "Postgres Prod",
  db_type: "postgres",
  host: "localhost",
  port: 5432,
  database: "app",
  username: "athas",
};

describe("connection store reliability", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useConnectionStore.setState({
      savedConnections: [],
      activeConnections: [],
      isLoadingSaved: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useConnectionStore.setState({
      savedConnections: [],
      activeConnections: [],
      isLoadingSaved: false,
    });
  });

  it("normalizes active connection errors", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("password authentication failed"));

    await expect(
      useConnectionStore.getState().actions.connect(postgresConnection, "secret"),
    ).rejects.toThrow("password authentication failed");

    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Prod",
        db_type: "postgres",
        status: "error",
        error: "password authentication failed",
      },
    ]);
  });

  it("falls back to an empty saved connection list when loading fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useConnectionStore.setState({ savedConnections: [postgresConnection] });
    mockInvoke.mockRejectedValueOnce(new Error("store unavailable"));

    await useConnectionStore.getState().actions.loadSavedConnections();

    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "Failed to load saved database connections: store unavailable",
    );
  });

  it("falls back to an empty saved connection list when loading returns malformed data", async () => {
    useConnectionStore.setState({ savedConnections: [postgresConnection] });
    mockInvoke.mockResolvedValueOnce({ id: "pg-prod" });

    await useConnectionStore.getState().actions.loadSavedConnections();

    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
  });

  it("normalizes saved connection entries when loading", async () => {
    mockInvoke.mockResolvedValueOnce([
      {
        ...postgresConnection,
        id: " pg-prod ",
        name: " Postgres Prod ",
        db_type: " postgres ",
        host: " localhost ",
        database: " app ",
        username: " athas ",
        connection_string: " ",
      },
      {
        ...postgresConnection,
        id: "pg-prod",
        name: "Duplicate",
      },
      {
        ...postgresConnection,
        id: "bad-port",
        port: 5432.5,
      },
      {
        ...postgresConnection,
        id: "bad-provider",
        db_type: "sqlite",
      },
      {
        ...postgresConnection,
        id: "bad-host",
        host: " ",
      },
      {
        ...postgresConnection,
        id: "string-mode",
        host: " ",
        connection_string: " postgres://localhost/app ",
      },
    ]);

    await useConnectionStore.getState().actions.loadSavedConnections();

    expect(useConnectionStore.getState().savedConnections).toEqual([
      postgresConnection,
      {
        ...postgresConnection,
        id: "string-mode",
        host: "",
        connection_string: "postgres://localhost/app",
      },
    ]);
  });

  it("keeps stale saved connection loads from replacing newer results", async () => {
    const first = deferred<SavedConnection[]>();
    const second = deferred<SavedConnection[]>();
    const newerConnection: SavedConnection = {
      ...postgresConnection,
      id: "pg-current",
      name: "Postgres Current",
    };
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const firstLoad = useConnectionStore.getState().actions.loadSavedConnections();
    const secondLoad = useConnectionStore.getState().actions.loadSavedConnections();

    second.resolve([newerConnection]);
    await secondLoad;

    expect(useConnectionStore.getState().savedConnections).toEqual([newerConnection]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);

    first.resolve([postgresConnection]);
    await firstLoad;
    await flushPromises();

    expect(useConnectionStore.getState().savedConnections).toEqual([newerConnection]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
  });

  it("disconnects an active connection before deleting the saved connection", async () => {
    useConnectionStore.setState({
      savedConnections: [postgresConnection],
      activeConnections: [
        {
          id: "pg-prod",
          name: "Postgres Prod",
          db_type: "postgres",
          status: "connected",
        },
      ],
    });
    mockInvoke.mockResolvedValue(undefined);

    await useConnectionStore.getState().actions.deleteConnection("pg-prod");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "disconnect_database", {
      connectionId: "pg-prod",
      dbType: "postgres",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "delete_saved_connection", {
      connectionId: "pg-prod",
    });
    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().activeConnections).toEqual([]);
  });

  it("normalizes connection ids before disconnecting and deleting", async () => {
    useConnectionStore.setState({
      savedConnections: [postgresConnection],
      activeConnections: [
        {
          id: "pg-prod",
          name: "Postgres Prod",
          db_type: "postgres",
          status: "connected",
        },
      ],
    });
    mockInvoke.mockResolvedValue(undefined);

    await useConnectionStore.getState().actions.deleteConnection(" pg-prod ");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "disconnect_database", {
      connectionId: "pg-prod",
      dbType: "postgres",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "delete_saved_connection", {
      connectionId: "pg-prod",
    });
    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().activeConnections).toEqual([]);
  });

  it("rejects blank connection ids before disconnecting or deleting", async () => {
    await expect(useConnectionStore.getState().actions.disconnect(" ")).rejects.toThrow(
      "Database connection id is required",
    );
    await expect(useConnectionStore.getState().actions.deleteConnection(" ")).rejects.toThrow(
      "Database connection id is required",
    );

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("still deletes a saved connection when disconnect cleanup fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    useConnectionStore.setState({
      savedConnections: [postgresConnection],
      activeConnections: [
        {
          id: "pg-prod",
          name: "Postgres Prod",
          db_type: "postgres",
          status: "connected",
        },
      ],
    });
    mockInvoke.mockRejectedValueOnce(new Error("sidecar unavailable")).mockResolvedValueOnce(null);

    await useConnectionStore.getState().actions.deleteConnection("pg-prod");

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "disconnect_database", {
      connectionId: "pg-prod",
      dbType: "postgres",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "delete_saved_connection", {
      connectionId: "pg-prod",
    });
    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().activeConnections).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "Failed to disconnect database before deleting: sidecar unavailable",
    );
  });

  it("keeps a newer active connection when a stale disconnect finishes", async () => {
    const disconnect = deferred<void>();
    const reconnect = deferred<void>();
    useConnectionStore.setState({
      activeConnections: [
        {
          id: "pg-prod",
          name: "Postgres Prod",
          db_type: "postgres",
          status: "connected",
        },
      ],
    });
    mockInvoke.mockReturnValueOnce(disconnect.promise).mockReturnValueOnce(reconnect.promise);

    const disconnectConnection = useConnectionStore.getState().actions.disconnect("pg-prod");
    const reconnectConnection = useConnectionStore
      .getState()
      .actions.connect({ ...postgresConnection, name: "Postgres Reconnected" }, "secret");

    reconnect.resolve(undefined);
    await expect(reconnectConnection).resolves.toBe("pg-prod");

    disconnect.resolve(undefined);
    await disconnectConnection;
    await flushPromises();

    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Reconnected",
        db_type: "postgres",
        status: "connected",
      },
    ]);
  });

  it("keeps pending saved connection loads from restoring deleted connections", async () => {
    const load = deferred<SavedConnection[]>();
    useConnectionStore.setState({ savedConnections: [postgresConnection] });
    mockInvoke.mockReturnValueOnce(load.promise).mockResolvedValueOnce(undefined);

    const loadSaved = useConnectionStore.getState().actions.loadSavedConnections();
    await useConnectionStore.getState().actions.deleteConnection("pg-prod");

    expect(useConnectionStore.getState().savedConnections).toEqual([]);

    load.resolve([postgresConnection]);
    await loadSaved;
    await flushPromises();

    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
  });

  it("keeps a saved connection locally when the post-save refresh fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInvoke.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("store offline"));

    await useConnectionStore.getState().actions.saveConnection(postgresConnection);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "save_connection", {
      connection: postgresConnection,
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "list_saved_connections");
    expect(useConnectionStore.getState().savedConnections).toEqual([postgresConnection]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      "Failed to refresh saved database connections: store offline",
    );
  });

  it("normalizes saved connections before saving optimistically", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unnormalizedConnection: SavedConnection = {
      ...postgresConnection,
      id: " pg-prod ",
      name: " Postgres Prod ",
      db_type: " postgres " as SavedConnection["db_type"],
      host: " localhost ",
      database: " app ",
      username: " athas ",
      connection_string: " ",
    };
    mockInvoke.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("store offline"));

    await useConnectionStore.getState().actions.saveConnection(unnormalizedConnection);

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "save_connection", {
      connection: postgresConnection,
    });
    expect(useConnectionStore.getState().savedConnections).toEqual([postgresConnection]);
    expect(warn).toHaveBeenCalledWith(
      "Failed to refresh saved database connections: store offline",
    );
  });

  it("rejects invalid saved connection configs before saving", async () => {
    await expect(
      useConnectionStore.getState().actions.saveConnection({ ...postgresConnection, port: 5432.5 }),
    ).rejects.toThrow("Invalid database connection config");
    await expect(
      useConnectionStore.getState().actions.saveConnection({ ...postgresConnection, host: " " }),
    ).rejects.toThrow("Invalid database connection config");

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("replaces the optimistic saved connection with the refreshed list", async () => {
    const refreshedConnection: SavedConnection = {
      ...postgresConnection,
      name: "Postgres Refreshed",
    };
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce([refreshedConnection]);

    await useConnectionStore.getState().actions.saveConnection(postgresConnection);

    expect(useConnectionStore.getState().savedConnections).toEqual([refreshedConnection]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
  });

  it("keeps saved connections array-shaped when the post-save refresh is malformed", async () => {
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: "pg-prod" });

    await useConnectionStore.getState().actions.saveConnection(postgresConnection);

    expect(useConnectionStore.getState().savedConnections).toEqual([]);
    expect(useConnectionStore.getState().isLoadingSaved).toBe(false);
  });

  it("keeps active connection metadata aligned after saving a connection", async () => {
    const renamedConnection: SavedConnection = {
      ...postgresConnection,
      name: "Postgres Renamed",
    };
    useConnectionStore.setState({
      savedConnections: [postgresConnection],
      activeConnections: [
        {
          id: "pg-prod",
          name: "Postgres Prod",
          db_type: "postgres",
          status: "connected",
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("store offline"));

    await useConnectionStore.getState().actions.saveConnection(renamedConnection);

    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Renamed",
        db_type: "postgres",
        status: "connected",
      },
    ]);
  });

  it("keeps stale connect failures from replacing a newer successful connection", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    mockInvoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const firstConnect = useConnectionStore
      .getState()
      .actions.connect(postgresConnection, "old-secret")
      .catch((err) => err);
    const secondConnect = useConnectionStore
      .getState()
      .actions.connect({ ...postgresConnection, name: "Postgres Current" }, "new-secret");

    second.resolve(undefined);
    await expect(secondConnect).resolves.toBe("pg-prod");

    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Current",
        db_type: "postgres",
        status: "connected",
      },
    ]);

    first.reject(new Error("old password failed"));
    await expect(firstConnect).resolves.toEqual(new Error("old password failed"));
    await flushPromises();

    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Current",
        db_type: "postgres",
        status: "connected",
      },
    ]);
  });

  it("normalizes connection configs before connecting", async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    await expect(
      useConnectionStore.getState().actions.connect({
        ...postgresConnection,
        id: " pg-prod ",
        name: " Postgres Prod ",
        db_type: " postgres " as SavedConnection["db_type"],
        host: " localhost ",
        database: " app ",
        username: " athas ",
        connection_string: " ",
      }),
    ).resolves.toBe("pg-prod");

    expect(mockInvoke).toHaveBeenCalledWith("connect_database", {
      config: {
        id: "pg-prod",
        name: "Postgres Prod",
        db_type: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "athas",
        connection_string: null,
      },
      password: null,
    });
    expect(useConnectionStore.getState().activeConnections).toEqual([
      {
        id: "pg-prod",
        name: "Postgres Prod",
        db_type: "postgres",
        status: "connected",
      },
    ]);
  });

  it("returns normalized test connection errors", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("password authentication failed"));

    await expect(
      useConnectionStore.getState().actions.testConnection(postgresConnection, "secret"),
    ).resolves.toEqual({
      ok: false,
      error: "password authentication failed",
    });

    expect(mockInvoke).toHaveBeenCalledWith("test_connection", {
      config: {
        id: "pg-prod",
        name: "Postgres Prod",
        db_type: "postgres",
        host: "localhost",
        port: 5432,
        database: "app",
        username: "athas",
        connection_string: null,
      },
      password: "secret",
    });
  });

  it("rejects invalid test connection configs before invoking Tauri", async () => {
    await expect(
      useConnectionStore
        .getState()
        .actions.testConnection({ ...postgresConnection, port: Number.NaN }),
    ).resolves.toEqual({
      ok: false,
      error: "Invalid database connection config",
    });
    await expect(
      useConnectionStore.getState().actions.testConnection({ ...postgresConnection, host: "" }),
    ).resolves.toEqual({
      ok: false,
      error: "Invalid database connection config",
    });

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("normalizes credential connection ids before invoking Tauri", async () => {
    mockInvoke.mockResolvedValueOnce(undefined).mockResolvedValueOnce("secret");

    await useConnectionStore.getState().actions.storeCredential(" pg-prod ", "secret");
    await expect(useConnectionStore.getState().actions.getCredential(" pg-prod ")).resolves.toBe(
      "secret",
    );

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "store_db_credential", {
      connectionId: "pg-prod",
      password: "secret",
    });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_db_credential", {
      connectionId: "pg-prod",
    });
  });

  it("normalizes malformed credential responses to null", async () => {
    mockInvoke.mockResolvedValueOnce({ password: "secret" }).mockResolvedValueOnce(null);

    await expect(useConnectionStore.getState().actions.getCredential("pg-prod")).resolves.toBe(
      null,
    );
    await expect(useConnectionStore.getState().actions.getCredential("pg-prod")).resolves.toBe(
      null,
    );
  });

  it("rejects blank credential connection ids before invoking Tauri", async () => {
    await expect(
      useConnectionStore.getState().actions.storeCredential(" ", "secret"),
    ).rejects.toThrow("Database connection id is required");
    await expect(useConnectionStore.getState().actions.getCredential(" ")).rejects.toThrow(
      "Database connection id is required",
    );

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
