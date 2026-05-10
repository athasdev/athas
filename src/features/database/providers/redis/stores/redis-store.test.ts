import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { invokeDatabaseProvider } from "@/features/database/services/database-provider-sidecar";
import { useRedisStore } from "./redis-store";

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

function setReadyRedisState() {
  useRedisStore.setState({
    connectionId: "redis-prod",
    fileName: "redis-prod",
    keys: [{ key: "existing", type: "string", ttl: -1 }],
    selectedKey: null,
    selectedKeyType: null,
    keyValue: null,
    scanPattern: "*",
    scanCursor: "0",
    hasMore: false,
    isLoading: false,
    isScanningKeys: false,
    error: null,
  });
}

describe("redis store reliability", () => {
  beforeEach(() => {
    mockInvokeDatabaseProvider.mockReset();
    useRedisStore.getState().actions.reset();
    setReadyRedisState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useRedisStore.getState().actions.reset();
  });

  it("keeps stale scans from replacing newer key results", async () => {
    const first = deferred<{
      keys: { key: string; type: string; ttl: number }[];
      cursor: string;
    }>();
    const second = deferred<{
      keys: { key: string; type: string; ttl: number }[];
      cursor: string;
    }>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    void useRedisStore.getState().actions.scanKeys("user:*", true);
    void useRedisStore.getState().actions.scanKeys("session:*", true);

    expect(useRedisStore.getState().isLoading).toBe(false);
    expect(useRedisStore.getState().isScanningKeys).toBe(true);

    second.resolve({ keys: [{ key: "session:1", type: "string", ttl: 10 }], cursor: "0" });
    await flushPromises();

    expect(useRedisStore.getState().keys).toEqual([{ key: "session:1", type: "string", ttl: 10 }]);
    expect(useRedisStore.getState().scanPattern).toBe("session:*");
    expect(useRedisStore.getState().isLoading).toBe(false);
    expect(useRedisStore.getState().isScanningKeys).toBe(false);

    first.resolve({ keys: [{ key: "user:1", type: "string", ttl: 20 }], cursor: "0" });
    await flushPromises();

    expect(useRedisStore.getState().keys).toEqual([{ key: "session:1", type: "string", ttl: 10 }]);
  });

  it("clears stale server info when initializing a new connection", async () => {
    const scan = deferred<{ keys: { key: string; type: string; ttl: number }[]; cursor: string }>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(scan.promise);
    useRedisStore.setState({
      keys: [{ key: "old", type: "string", ttl: -1 }],
      selectedKey: "old",
      selectedKeyType: "string",
      keyValue: "old value",
      serverInfo: { redis_version: "7.2.0" },
      scanPattern: "old:*",
      scanCursor: "42",
      hasMore: true,
    });

    void useRedisStore.getState().actions.init("redis-dev");

    expect(useRedisStore.getState().connectionId).toBe("redis-dev");
    expect(useRedisStore.getState().keys).toEqual([]);
    expect(useRedisStore.getState().selectedKey).toBeNull();
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();
    expect(useRedisStore.getState().serverInfo).toBeNull();
    expect(useRedisStore.getState().scanPattern).toBe("*");
    expect(useRedisStore.getState().scanCursor).toBe("0");
    expect(useRedisStore.getState().hasMore).toBe(false);

    scan.resolve({ keys: [], cursor: "0" });
    await flushPromises();
  });

  it("keeps stale value reads from replacing the selected key value", async () => {
    const first = deferred<{ type: string; value: unknown }>();
    const second = deferred<{ type: string; value: unknown }>();
    mockInvokeDatabaseProvider
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    void useRedisStore.getState().actions.selectKey("user:1");
    void useRedisStore.getState().actions.selectKey("user:2");

    second.resolve({ type: "string", value: "newer" });
    await flushPromises();

    expect(useRedisStore.getState().selectedKey).toBe("user:2");
    expect(useRedisStore.getState().keyValue).toBe("newer");

    first.resolve({ type: "string", value: "stale" });
    await flushPromises();

    expect(useRedisStore.getState().selectedKey).toBe("user:2");
    expect(useRedisStore.getState().keyValue).toBe("newer");
  });

  it("keeps existing keys when a scan fails", async () => {
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("network down"));

    await useRedisStore.getState().actions.scanKeys("*", true);

    expect(useRedisStore.getState().keys).toEqual([{ key: "existing", type: "string", ttl: -1 }]);
    expect(useRedisStore.getState().isLoading).toBe(false);
    expect(useRedisStore.getState().isScanningKeys).toBe(false);
    expect(useRedisStore.getState().error).toBe("Scan failed: network down");
  });

  it("deduplicates keys when appending scan results", async () => {
    useRedisStore.setState({
      keys: [
        { key: "user:1", type: "string", ttl: -1 },
        { key: "user:2", type: "hash", ttl: 60 },
      ],
      scanCursor: "42",
      hasMore: true,
    });
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      keys: [
        { key: "user:2", type: "hash", ttl: 60 },
        { key: "user:3", type: "string", ttl: 30 },
      ],
      cursor: "0",
    });

    await useRedisStore.getState().actions.scanKeys("user:*", false);

    expect(useRedisStore.getState().keys).toEqual([
      { key: "user:1", type: "string", ttl: -1 },
      { key: "user:2", type: "hash", ttl: 60 },
      { key: "user:3", type: "string", ttl: 30 },
    ]);
    expect(useRedisStore.getState().hasMore).toBe(false);
  });

  it("normalizes blank scan patterns and invalid cursors", async () => {
    useRedisStore.setState({ scanPattern: "   ", scanCursor: "" });
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      keys: [{ key: "user:1", type: "string", ttl: 30 }],
      cursor: "",
    });

    await useRedisStore.getState().actions.scanKeys(undefined, false);

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("redis_scan_keys", {
      connectionId: "redis-prod",
      pattern: "*",
      cursor: "0",
      count: 100,
    });
    expect(useRedisStore.getState().scanPattern).toBe("*");
    expect(useRedisStore.getState().scanCursor).toBe("0");
    expect(useRedisStore.getState().hasMore).toBe(false);

    useRedisStore.getState().actions.setScanPattern("  ");
    expect(useRedisStore.getState().scanPattern).toBe("*");
  });

  it("trims Redis scan cursors before sending and storing them", async () => {
    useRedisStore.setState({ scanCursor: " 42 ", hasMore: true });
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      keys: [{ key: "user:2", type: "string", ttl: 30 }],
      cursor: " 84 ",
    });

    await useRedisStore.getState().actions.scanKeys("user:*", false);

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledWith("redis_scan_keys", {
      connectionId: "redis-prod",
      pattern: "user:*",
      cursor: "42",
      count: 100,
    });
    expect(useRedisStore.getState().scanCursor).toBe("84");
    expect(useRedisStore.getState().hasMore).toBe(true);
  });

  it("normalizes malformed Redis scan key results", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      keys: [
        { key: " user:1 ", type: " string ", ttl: 30.8 },
        { key: "", type: "hash", ttl: 60 },
        { key: "user:1", type: "hash", ttl: 60 },
        { key: "user:2", ttl: Number.NaN },
        "user:3",
      ],
      cursor: 42,
    });

    await useRedisStore.getState().actions.scanKeys("user:*", true);

    expect(useRedisStore.getState().keys).toEqual([
      { key: "user:1", type: "string", ttl: 30 },
      { key: "user:2", type: "unknown", ttl: -1 },
    ]);
    expect(useRedisStore.getState().scanCursor).toBe("0");
    expect(useRedisStore.getState().hasMore).toBe(false);
  });

  it("clears selected key state when starting a reset scan", async () => {
    const scan = deferred<{ keys: { key: string; type: string; ttl: number }[]; cursor: string }>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(scan.promise);
    useRedisStore.setState({
      selectedKey: "existing",
      selectedKeyType: "string",
      keyValue: "old value",
    });

    const scanKeys = useRedisStore.getState().actions.scanKeys("session:*", true);

    expect(useRedisStore.getState().selectedKey).toBeNull();
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();

    scan.resolve({ keys: [{ key: "session:1", type: "string", ttl: 10 }], cursor: "0" });
    await scanKeys;

    expect(useRedisStore.getState().keys).toEqual([{ key: "session:1", type: "string", ttl: 10 }]);
  });

  it("clears loading state when value mutations fail", async () => {
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("readonly replica"));
    useRedisStore.setState({ selectedKey: "existing" });

    await useRedisStore.getState().actions.setValue("existing", "new value");

    expect(useRedisStore.getState().isLoading).toBe(false);
    expect(useRedisStore.getState().error).toBe("Set failed: readonly replica");
  });

  it("normalizes Redis keys before value actions", async () => {
    mockInvokeDatabaseProvider
      .mockResolvedValueOnce({ type: "string", value: "value" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    useRedisStore.setState({
      keys: [{ key: "existing", type: "string", ttl: -1 }],
      selectedKey: "existing",
    });

    await useRedisStore.getState().actions.selectKey(" existing ");
    await useRedisStore.getState().actions.setValue(" existing ", "new value");
    await useRedisStore.getState().actions.deleteKey(" existing ");

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "redis_get_value", {
      connectionId: "redis-prod",
      key: "existing",
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "redis_set_value", {
      connectionId: "redis-prod",
      key: "existing",
      value: "new value",
      ttl: null,
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(3, "redis_get_value", {
      connectionId: "redis-prod",
      key: "existing",
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(4, "redis_delete_key", {
      connectionId: "redis-prod",
      key: "existing",
    });
  });

  it("ignores blank Redis keys before value actions", async () => {
    await useRedisStore.getState().actions.selectKey(" ");
    await useRedisStore.getState().actions.setValue(" ", "new value");
    await useRedisStore.getState().actions.deleteKey(" ");

    expect(mockInvokeDatabaseProvider).not.toHaveBeenCalled();
    expect(useRedisStore.getState().selectedKey).toBeNull();
  });

  it("does not select an unselected key after setting it", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce(null);
    useRedisStore.setState({
      selectedKey: null,
      selectedKeyType: null,
      keyValue: null,
    });

    await useRedisStore.getState().actions.setValue("existing", "new value");
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(useRedisStore.getState().selectedKey).toBeNull();
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();
    expect(useRedisStore.getState().isLoading).toBe(false);
  });

  it("preserves existing value loading while setting an unselected key", async () => {
    const save = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(save.promise);
    useRedisStore.setState({
      selectedKey: "selected",
      selectedKeyType: null,
      keyValue: null,
      isLoading: true,
    });

    const mutation = useRedisStore.getState().actions.setValue("other", "new value");

    expect(useRedisStore.getState().isLoading).toBe(true);

    save.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(useRedisStore.getState().selectedKey).toBe("selected");
    expect(useRedisStore.getState().isLoading).toBe(true);
  });

  it("normalizes Redis value TTLs before saving", async () => {
    mockInvokeDatabaseProvider.mockResolvedValue(undefined);

    await useRedisStore.getState().actions.setValue("existing", "new value", 10.8);
    await useRedisStore.getState().actions.setValue("existing", "new value", Number.NaN);
    await useRedisStore.getState().actions.setValue("existing", "new value", -1);

    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(1, "redis_set_value", {
      connectionId: "redis-prod",
      key: "existing",
      value: "new value",
      ttl: 10,
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(2, "redis_set_value", {
      connectionId: "redis-prod",
      key: "existing",
      value: "new value",
      ttl: null,
    });
    expect(mockInvokeDatabaseProvider).toHaveBeenNthCalledWith(3, "redis_set_value", {
      connectionId: "redis-prod",
      key: "existing",
      value: "new value",
      ttl: null,
    });
  });

  it("does not reload a stale value mutation after selection changes", async () => {
    const save = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(save.promise);
    useRedisStore.setState({ selectedKey: "existing" });

    const mutation = useRedisStore.getState().actions.setValue("existing", "new value");
    useRedisStore.setState({
      selectedKey: "other",
      selectedKeyType: "string",
      keyValue: "other value",
      isLoading: false,
    });

    save.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(mockInvokeDatabaseProvider).toHaveBeenCalledTimes(1);
    expect(useRedisStore.getState().selectedKey).toBe("other");
    expect(useRedisStore.getState().keyValue).toBe("other value");
  });

  it("does not report stale value mutation errors after selection changes", async () => {
    const save = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(save.promise);
    useRedisStore.setState({ selectedKey: "existing" });

    const mutation = useRedisStore.getState().actions.setValue("existing", "new value");
    useRedisStore.setState({
      selectedKey: "other",
      selectedKeyType: "string",
      keyValue: "other value",
      isLoading: false,
      error: null,
    });

    save.reject(new Error("readonly replica"));
    await mutation;
    await flushPromises();

    expect(useRedisStore.getState().selectedKey).toBe("other");
    expect(useRedisStore.getState().keyValue).toBe("other value");
    expect(useRedisStore.getState().error).toBeNull();
  });

  it("does not remove keys from a newer connection after a stale delete finishes", async () => {
    const deletion = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(deletion.promise);

    const mutation = useRedisStore.getState().actions.deleteKey("existing");
    useRedisStore.setState({
      connectionId: "redis-dev",
      keys: [{ key: "existing", type: "string", ttl: 60 }],
      isLoading: false,
    });

    deletion.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(useRedisStore.getState().connectionId).toBe("redis-dev");
    expect(useRedisStore.getState().keys).toEqual([{ key: "existing", type: "string", ttl: 60 }]);
  });

  it("does not show value loading while deleting an unselected key", async () => {
    const deletion = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(deletion.promise);
    useRedisStore.setState({
      selectedKey: "selected",
      selectedKeyType: "string",
      keyValue: "selected value",
      keys: [
        { key: "selected", type: "string", ttl: -1 },
        { key: "other", type: "string", ttl: -1 },
      ],
    });

    const mutation = useRedisStore.getState().actions.deleteKey("other");

    expect(useRedisStore.getState().isLoading).toBe(false);
    expect(useRedisStore.getState().selectedKey).toBe("selected");
    expect(useRedisStore.getState().keyValue).toBe("selected value");

    deletion.resolve(undefined);
    await mutation;

    expect(useRedisStore.getState().keys).toEqual([{ key: "selected", type: "string", ttl: -1 }]);
    expect(useRedisStore.getState().selectedKey).toBe("selected");
    expect(useRedisStore.getState().keyValue).toBe("selected value");
  });

  it("preserves existing value loading while deleting an unselected key", async () => {
    const deletion = deferred<unknown>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(deletion.promise);
    useRedisStore.setState({
      selectedKey: "selected",
      selectedKeyType: null,
      keyValue: null,
      isLoading: true,
      keys: [
        { key: "selected", type: "string", ttl: -1 },
        { key: "other", type: "string", ttl: -1 },
      ],
    });

    const mutation = useRedisStore.getState().actions.deleteKey("other");

    expect(useRedisStore.getState().isLoading).toBe(true);

    deletion.resolve(undefined);
    await mutation;
    await flushPromises();

    expect(useRedisStore.getState().keys).toEqual([{ key: "selected", type: "string", ttl: -1 }]);
    expect(useRedisStore.getState().selectedKey).toBe("selected");
    expect(useRedisStore.getState().isLoading).toBe(true);
  });

  it("ignores pending value reads after deleting the selected key", async () => {
    const valueRead = deferred<{ type: string; value: unknown }>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(valueRead.promise).mockResolvedValueOnce(null);

    const selectKey = useRedisStore.getState().actions.selectKey("existing");
    await flushPromises();

    await useRedisStore.getState().actions.deleteKey("existing");

    expect(useRedisStore.getState().selectedKey).toBeNull();
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();

    valueRead.resolve({ type: "string", value: "stale" });
    await selectKey;
    await flushPromises();

    expect(useRedisStore.getState().selectedKey).toBeNull();
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();
  });

  it("clears stale key values before loading a selected key", async () => {
    useRedisStore.setState({
      selectedKey: "existing",
      selectedKeyType: "string",
      keyValue: "old value",
    });
    mockInvokeDatabaseProvider.mockRejectedValueOnce(new Error("missing key"));

    await useRedisStore.getState().actions.selectKey("missing");

    expect(useRedisStore.getState().selectedKey).toBe("missing");
    expect(useRedisStore.getState().selectedKeyType).toBeNull();
    expect(useRedisStore.getState().keyValue).toBeNull();
    expect(useRedisStore.getState().error).toBe("Failed to get value: missing key");
  });

  it("normalizes malformed Redis value responses", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({ type: " hash " });

    await useRedisStore.getState().actions.selectKey("existing");

    expect(useRedisStore.getState().selectedKeyType).toBe("hash");
    expect(useRedisStore.getState().keyValue).toBeNull();

    mockInvokeDatabaseProvider.mockResolvedValueOnce(["not an envelope"]);

    await useRedisStore.getState().actions.selectKey("other");

    expect(useRedisStore.getState().selectedKeyType).toBe("unknown");
    expect(useRedisStore.getState().keyValue).toBeNull();
  });

  it("keeps pending server info responses from restoring state after reset", async () => {
    const info = deferred<Record<string, string>>();
    mockInvokeDatabaseProvider.mockReturnValueOnce(info.promise);

    const loadInfo = useRedisStore.getState().actions.getServerInfo();
    useRedisStore.getState().actions.reset();

    info.resolve({ redis_version: "7.2.0" });
    await loadInfo;
    await flushPromises();

    expect(useRedisStore.getState().connectionId).toBeNull();
    expect(useRedisStore.getState().serverInfo).toBeNull();
    expect(useRedisStore.getState().isLoading).toBe(false);
  });

  it("normalizes Redis server info responses", async () => {
    mockInvokeDatabaseProvider.mockResolvedValueOnce({
      " redis_version ": "7.2.0",
      uptime_in_seconds: 42,
      blank: null,
      " ": "ignored",
    });

    await useRedisStore.getState().actions.getServerInfo();

    expect(useRedisStore.getState().serverInfo).toEqual({
      redis_version: "7.2.0",
      uptime_in_seconds: "42",
    });
  });

  it("clears Redis server info when the response is malformed", async () => {
    useRedisStore.setState({ serverInfo: { redis_version: "7.2.0" } });
    mockInvokeDatabaseProvider.mockResolvedValueOnce(["redis_version"]);

    await useRedisStore.getState().actions.getServerInfo();

    expect(useRedisStore.getState().serverInfo).toBeNull();
  });
});
