import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

class MemoryStore {
  data = new Map<string, unknown>();
  saves = 0;

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string) {
    return this.data.delete(key);
  }

  async save() {
    this.saves += 1;
  }
}

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  telemetryStore: null as unknown as MemoryStore,
  settingsStore: null as unknown as MemoryStore,
  version: "1.2.0",
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => mocks.telemetryStore),
}));
vi.mock("@/features/settings/services/settings-persistence", () => ({
  getSettingsStore: vi.fn(async () => mocks.settingsStore),
}));
vi.mock("@/utils/tauri-fetch", () => ({ tauriFetch: mocks.fetch }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => mocks.version) }));
vi.mock("@tauri-apps/plugin-os", () => ({ platform: () => "macos", arch: () => "aarch64" }));

type Telemetry = typeof import("@/features/telemetry/services/telemetry");

interface SentBatch {
  device_id: string;
  app_version: string;
  platform: string;
  arch: string;
  events: Array<{ id: string; type: string; occurred_at: string; payload: Record<string, any> }>;
}

async function loadTelemetry(): Promise<Telemetry> {
  return import("@/features/telemetry/services/telemetry");
}

function queue(): Array<{ type: string; payload: Record<string, any> }> {
  return (mocks.telemetryStore.data.get("telemetry_queue_v1") as any[]) ?? [];
}

function log(): Array<{ status: string; eventType: string; summary: string; error?: string }> {
  return (mocks.telemetryStore.data.get("telemetry_log_v1") as any[]) ?? [];
}

function sentBatches(): SentBatch[] {
  return mocks.fetch.mock.calls.map(([, init]) => JSON.parse(init.body as string));
}

async function waitForFlush() {
  await vi.waitFor(() => {
    expect(log().some((entry) => entry.status === "sent" || entry.status === "failed")).toBe(true);
  });
}

describe("telemetry service", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.fetch.mockReset();
    mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
    mocks.telemetryStore = new MemoryStore();
    mocks.settingsStore = new MemoryStore({ telemetry: true });
    mocks.version = "1.2.0";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("when usage telemetry is disabled", () => {
    beforeEach(() => {
      mocks.settingsStore = new MemoryStore({ telemetry: false });
    });

    it("drops optional events without queueing or sending", async () => {
      const telemetry = await loadTelemetry();

      await expect(
        telemetry.recordExtensionLifecycleTelemetry({
          type: "extension_install",
          extensionId: "rust",
          version: "1.0.0",
        }),
      ).resolves.toBe(false);
      await expect(
        telemetry.recordCrashReport({ kind: "window_error", message: "boom" }),
      ).resolves.toBe(false);
      await expect(
        telemetry.recordAiFailure({ kind: "builtin", providerId: "openai", phase: "stream" }),
      ).resolves.toBe(false);

      expect(queue()).toEqual([]);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("keeps friction signals in the local log only", async () => {
      const telemetry = await loadTelemetry();

      await expect(
        telemetry.recordFrictionSignal({ area: "agent", signal: "retry" } as never),
      ).resolves.toBe(false);

      expect(queue()).toEqual([]);
      expect(log()).toEqual([
        expect.objectContaining({ status: "local", eventType: "friction:agent:retry" }),
      ]);
      expect(mocks.fetch).not.toHaveBeenCalled();
    });

    it("still queues required update-check events", async () => {
      const telemetry = await loadTelemetry();

      await expect(
        telemetry.recordUpdateCheckTelemetry({ status: "up_to_date", currentVersion: "1.2.0" }),
      ).resolves.toBe(true);

      expect(queue()).toEqual([
        expect.objectContaining({
          type: "update_check",
          payload: expect.objectContaining({ status: "up_to_date", updater_enabled: true }),
        }),
      ]);
    });

    it("discards optional events queued before telemetry was turned off and sends only required ones", async () => {
      mocks.telemetryStore = new MemoryStore({
        telemetry_last_heartbeat: Date.now(),
        telemetry_queue_v1: [
          { id: "a", type: "heartbeat", occurredAt: "2026-01-01T00:00:00Z", payload: {} },
          { id: "b", type: "crash_report", occurredAt: "2026-01-01T00:00:00Z", payload: {} },
          { id: "c", type: "update_check", occurredAt: "2026-01-01T00:00:00Z", payload: {} },
        ],
      });
      vi.useFakeTimers();
      const telemetry = await loadTelemetry();

      telemetry.initializeTelemetry();
      await vi.advanceTimersByTimeAsync(10_000 + 5 * 60 * 1000);
      vi.useRealTimers();
      await waitForFlush();

      expect(sentBatches()).toHaveLength(1);
      expect(sentBatches()[0].events.map((event) => event.id)).toEqual(["c"]);
      expect(queue()).toEqual([]);
    });

    it("does not send anything when only optional events were queued", async () => {
      mocks.telemetryStore = new MemoryStore({
        telemetry_last_heartbeat: Date.now(),
        telemetry_queue_v1: [
          { id: "a", type: "heartbeat", occurredAt: "2026-01-01T00:00:00Z", payload: {} },
        ],
      });
      vi.useFakeTimers();
      const telemetry = await loadTelemetry();

      telemetry.initializeTelemetry();
      await vi.advanceTimersByTimeAsync(10_000 + 5 * 60 * 1000);

      expect(mocks.fetch).not.toHaveBeenCalled();
      expect(queue()).toEqual([]);
    });
  });

  it("reads the legacy nested settings flag when the top-level flag is missing", async () => {
    mocks.settingsStore = new MemoryStore({ settings: { telemetry: true } });
    const telemetry = await loadTelemetry();

    await expect(
      telemetry.recordExtensionRegistrySync({ installedExtensions: [{ id: "go" }] }),
    ).resolves.toBe(true);

    mocks.settingsStore = new MemoryStore({ settings: { telemetry: "yes" } });
    vi.resetModules();
    const reloaded = await loadTelemetry();
    await expect(
      reloaded.recordExtensionRegistrySync({ installedExtensions: [{ id: "go" }] }),
    ).resolves.toBe(false);
  });

  it("queues events with client context and a sanitized payload", async () => {
    mocks.telemetryStore = new MemoryStore({
      telemetry_install_date: "2025-01-01T00:00:00.000Z",
      telemetry_launch_count: 4,
      telemetry_last_app_version: "1.1.0",
    });
    const telemetry = await loadTelemetry();

    await telemetry.recordExtensionUpdateCheck({
      installedExtensions: [{ id: "rust", version: "2.0.0" }, { id: "go" }],
      updates: ["rust"],
    });

    expect(queue()).toEqual([
      {
        id: expect.any(String),
        type: "extension_update_check",
        occurredAt: expect.any(String),
        payload: {
          installed_extensions: [
            { id: "rust", version: "2.0.0" },
            { id: "go", version: null },
          ],
          update_candidates: ["rust"],
          installed_count: 2,
          update_count: 1,
          install_date: "2025-01-01T00:00:00.000Z",
          previous_version: "1.1.0",
          launch_count: 5,
        },
      },
    ]);
    expect(mocks.telemetryStore.data.get("telemetry_launch_count")).toBe(5);
    expect(mocks.telemetryStore.data.get("telemetry_last_app_version")).toBe("1.2.0");
    expect(typeof mocks.telemetryStore.data.get("telemetry_device_id")).toBe("string");
    expect(log().slice(-1)[0]).toMatchObject({
      status: "queued",
      eventType: "extension_update_check",
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("omits previous_version when the app version did not change", async () => {
    mocks.telemetryStore = new MemoryStore({ telemetry_last_app_version: "1.2.0" });
    const telemetry = await loadTelemetry();

    await telemetry.recordExtensionLifecycleTelemetry({
      type: "extension_uninstall",
      extensionId: "rust",
    });

    expect(queue()[0].payload).toMatchObject({
      extension_id: "rust",
      extension_version: null,
      previous_version: null,
      launch_count: 1,
    });
  });

  it("migrates legacy telemetry keys out of the settings store", async () => {
    mocks.settingsStore = new MemoryStore({
      telemetry: true,
      telemetry_device_id: "legacy-device",
      telemetry_launch_count: 9,
    });
    mocks.telemetryStore = new MemoryStore({ telemetry_launch_count: 2 });
    const telemetry = await loadTelemetry();

    await telemetry.recordCrashReport({ kind: "window_error", message: "boom" });
    await waitForFlush();

    expect(mocks.settingsStore.data.has("telemetry_device_id")).toBe(false);
    expect(mocks.settingsStore.data.has("telemetry_launch_count")).toBe(false);
    expect(mocks.telemetryStore.data.get("telemetry_launch_count")).toBe(3);
    expect(sentBatches()[0].device_id).toBe("legacy-device");
  });

  it("sends crash reports immediately with redacted text and clears the queue on success", async () => {
    const telemetry = await loadTelemetry();

    await expect(
      telemetry.recordCrashReport({
        kind: "unhandled_rejection",
        message: "Failed to open /Users/alice/secret/project.ts",
        stack: "Error\n    at /Users/alice/secret/project.ts:1:1",
        when: new Date("2026-01-02T03:04:05.000Z"),
        cause: new Error("inner"),
        nested: { list: [1, undefined] },
      }),
    ).resolves.toBe(true);
    await waitForFlush();

    const [url, init] = mocks.fetch.mock.calls[0];
    expect(url).toMatch(/\/api\/telemetry\/events$/);
    expect(init).toMatchObject({ method: "POST" });
    const [batch] = sentBatches();
    expect(batch).toMatchObject({ app_version: "1.2.0", platform: "macos", arch: "aarch64" });
    const payload = batch.events[0].payload;
    expect(batch.events[0].type).toBe("crash_report");
    expect(payload.message).not.toContain("alice");
    expect(payload.stack).not.toContain("alice");
    expect(payload.report_source).toBe("desktop_runtime");
    expect(payload.when).toBe("2026-01-02T03:04:05.000Z");
    expect(payload.cause).toMatchObject({ message: "inner" });
    expect(payload.nested).toEqual({ list: [1, "undefined"] });
    expect(queue()).toEqual([]);
    expect(log().slice(-1)[0]).toMatchObject({ status: "sent", summary: "Sent 1 telemetry event" });
  });

  it("keeps the queue and logs the failure when the upload is rejected", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 503 });
    const telemetry = await loadTelemetry();

    await telemetry.recordCrashReport({ kind: "window_error", message: "boom" });
    await waitForFlush();

    expect(queue()).toHaveLength(1);
    expect(log().slice(-1)[0]).toMatchObject({
      status: "failed",
      eventType: "batch",
      summary: "Failed to send 1 telemetry event",
      error: "Telemetry upload failed (503)",
    });
  });

  it("logs network errors without rejecting the caller", async () => {
    mocks.fetch.mockRejectedValue("offline");
    const telemetry = await loadTelemetry();

    await expect(
      telemetry.recordCrashReport({ kind: "window_error", message: "boom" }),
    ).resolves.toBe(true);
    await waitForFlush();

    expect(log().slice(-1)[0]).toMatchObject({ status: "failed", error: "offline" });
  });

  it("never rejects when persisting a crash report fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.telemetryStore.set = async () => {
      throw new Error("disk full");
    };
    const telemetry = await loadTelemetry();

    await expect(
      telemetry.recordCrashReport({ kind: "window_error", message: "boom" }),
    ).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("flushes in chunks of 50 once the queue reaches the threshold", async () => {
    const existing = Array.from({ length: 74 }, (_, index) => ({
      id: `e${index}`,
      type: "heartbeat",
      occurredAt: "2026-01-01T00:00:00Z",
      payload: {},
    }));
    mocks.telemetryStore = new MemoryStore({
      telemetry_queue_v1: [...existing, { broken: true }],
    });
    const telemetry = await loadTelemetry();

    await telemetry.recordAiFailure({ kind: "acp", providerId: "claude", phase: "provider" });
    await waitForFlush();

    const batches = sentBatches();
    expect(batches.map((batch) => batch.events.length)).toEqual([50, 25]);
    expect(log().slice(-1)[0]).toMatchObject({ summary: "Sent 75 telemetry events" });
    expect(queue()).toEqual([]);
  });

  it("caps the local queue at 200 events and logs what was dropped", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 500 });
    const existing = Array.from({ length: 200 }, (_, index) => ({
      id: `e${index}`,
      type: "extension_install",
      occurredAt: "2026-01-01T00:00:00Z",
      payload: {},
    }));
    mocks.telemetryStore = new MemoryStore({ telemetry_queue_v1: existing });
    const telemetry = await loadTelemetry();

    await telemetry.recordExtensionRegistrySync({ installedExtensions: [] });
    await waitForFlush();

    expect(queue()).toHaveLength(200);
    expect(queue()[0]).toMatchObject({ id: "e1" });
    expect(queue().slice(-1)[0]).toMatchObject({ type: "extension_registry_sync" });
    expect(log().find((entry) => entry.status === "dropped")).toMatchObject({
      eventType: "extension_install",
    });
  });

  it("shares one in-flight flush between concurrent triggers", async () => {
    let release: (value: { ok: boolean; status: number }) => void = () => {};
    mocks.fetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const telemetry = await loadTelemetry();

    await telemetry.recordCrashReport({ kind: "window_error", message: "one" });
    await telemetry.recordCrashReport({ kind: "window_error", message: "two" });
    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    release({ ok: true, status: 200 });
    await waitForFlush();

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("caps the log, notifies subscribers, and can be cleared", async () => {
    mocks.telemetryStore = new MemoryStore({
      telemetry_log_v1: [
        ...Array.from({ length: 149 }, (_, index) => ({
          id: `l${index}`,
          timestamp: "2026-01-01T00:00:00Z",
          status: "queued",
          eventType: "heartbeat",
          summary: "Queued heartbeat",
        })),
        { id: "bad" },
      ],
    });
    const telemetry = await loadTelemetry();
    const received: number[] = [];
    const unsubscribe = telemetry.subscribeToTelemetryLog((entries) =>
      received.push(entries.length),
    );
    await vi.waitFor(() => expect(received).toEqual([149]));

    await telemetry.recordExtensionRegistrySync({ installedExtensions: [] });
    await telemetry.recordExtensionRegistrySync({ installedExtensions: [] });
    expect(received.slice(1)).toEqual([150, 150]);
    expect((await telemetry.getTelemetryLogEntries())[0].id).toBe("l1");

    await telemetry.clearTelemetryLogEntries();
    expect(await telemetry.getTelemetryLogEntries()).toEqual([
      expect.objectContaining({ status: "cleared", eventType: "log" }),
    ]);

    unsubscribe();
    const countBefore = received.length;
    await telemetry.recordExtensionRegistrySync({ installedExtensions: [] });
    expect(received).toHaveLength(countBefore);
  });

  describe("initialization", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it("queues one heartbeat after the startup delay and flushes on the interval", async () => {
      const telemetry = await loadTelemetry();

      await telemetry.initializeTelemetry();
      expect(telemetry.initializeTelemetry()).toBe(telemetry.initializeTelemetry());
      await vi.advanceTimersByTimeAsync(9_999);
      expect(queue()).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(queue()).toHaveLength(1));
      expect(queue()[0]).toMatchObject({
        type: "heartbeat",
        payload: { session_platform: "macos", session_arch: "aarch64", updater_enabled: true },
      });
      expect(typeof mocks.telemetryStore.data.get("telemetry_last_heartbeat")).toBe("number");

      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
      expect(sentBatches()[0].events.some((event) => event.type === "heartbeat")).toBe(true);
    });

    it("skips the heartbeat when one was queued recently", async () => {
      mocks.telemetryStore = new MemoryStore({ telemetry_last_heartbeat: Date.now() });
      const telemetry = await loadTelemetry();

      telemetry.initializeTelemetry();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(queue()).toEqual([]);
    });

    it("does not mark a heartbeat when usage telemetry is off", async () => {
      mocks.settingsStore = new MemoryStore({ telemetry: false });
      const telemetry = await loadTelemetry();

      telemetry.initializeTelemetry();
      await vi.advanceTimersByTimeAsync(10_000);

      expect(queue()).toEqual([]);
      expect(mocks.telemetryStore.data.has("telemetry_last_heartbeat")).toBe(false);
    });
  });

  describe("crash listeners", () => {
    let listeners: Map<string, (event: any) => void>;

    beforeEach(() => {
      listeners = new Map();
      vi.stubGlobal("window", {
        addEventListener: (type: string, listener: (event: any) => void) =>
          listeners.set(type, listener),
      });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("reports window errors but ignores benign ResizeObserver noise", async () => {
      const telemetry = await loadTelemetry();
      telemetry.initializeTelemetry();

      listeners.get("error")?.({
        message: "ResizeObserver loop limit exceeded",
        filename: "",
        lineno: 0,
        colno: 0,
      });
      listeners.get("error")?.({
        message: "TypeError: x is undefined",
        filename: "app.js",
        lineno: 3,
        colno: 7,
        error: new Error("x is undefined"),
      });
      await waitForFlush();

      const events = sentBatches().flatMap((batch) => batch.events);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        kind: "window_error",
        message: "TypeError: x is undefined",
        line: 3,
        column: 7,
      });
    });

    it("reports unhandled rejections but swallows expected cancellations", async () => {
      const telemetry = await loadTelemetry();
      telemetry.initializeTelemetry();
      const preventDefault = vi.fn();

      listeners.get("unhandledrejection")?.({ reason: "Canceled", preventDefault });
      listeners.get("unhandledrejection")?.({ reason: 42, preventDefault });
      await waitForFlush();

      expect(preventDefault).toHaveBeenCalledTimes(1);
      const events = sentBatches().flatMap((batch) => batch.events);
      expect(events).toHaveLength(1);
      expect(events[0].payload).toMatchObject({
        kind: "unhandled_rejection",
        message: "42",
      });
    });
  });
});
