// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SETTINGS_SCHEMA_VERSION } from "@/features/settings/lib/settings-migrations";

interface CloudSnapshot {
  schemaVersion: number;
  updatedAt: string;
  settings: Record<string, unknown>;
}

vi.hoisted(() => {
  Object.assign(window, {
    __TAURI_INTERNALS__: {
      invoke: async () => null,
      transformCallback: () => 0,
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    },
  });
});

const cloud = vi.hoisted(() => ({
  snapshot: null as CloudSnapshot | null,
  failure: null as { status: number; error?: string } | null,
  puts: [] as Array<{ schemaVersion: number; settings: Record<string, unknown> }>,
  clock: 0,
  fetch: vi.fn(),
}));

vi.mock("@/features/auth/services/auth-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/auth/services/auth-api")>();
  return { ...actual, authenticatedFetch: cloud.fetch };
});
vi.mock("@/features/settings/services/settings-persistence", () => ({
  debouncedSaveSettingsToStore: vi.fn(),
  loadSettingsFromStore: vi.fn(),
  saveSettingsToStore: vi.fn(async () => {}),
}));
vi.mock("@/features/settings/lib/settings-effects", () => ({
  applySettingSideEffect: vi.fn(),
  applySettingsSideEffects: vi.fn(),
}));

const META_KEY = "athas.settingsSync.meta";

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function cloudFetch(_path: string, options: { method?: string; body?: string } = {}) {
  if (cloud.failure) {
    return Promise.resolve(respond(cloud.failure.status, { error: cloud.failure.error }));
  }
  if (options.method === "PUT") {
    const input = JSON.parse(options.body ?? "{}");
    cloud.puts.push(input);
    cloud.clock += 1000;
    cloud.snapshot = {
      ...input,
      updatedAt: new Date(Date.UTC(2026, 0, 1) + cloud.clock).toISOString(),
    };
    return Promise.resolve(respond(200, { snapshot: cloud.snapshot }));
  }
  return Promise.resolve(respond(200, { snapshot: cloud.snapshot }));
}

async function loadModules() {
  const sync = await import("@/features/settings/lib/settings-sync");
  const { useSettingsStore } = await import("@/features/settings/stores/settings.store");
  const { useSettingsSyncStore } = await import("@/features/settings/stores/settings-sync.store");
  return { sync, useSettingsStore, useSettingsSyncStore };
}

function meta() {
  return JSON.parse(window.localStorage.getItem(META_KEY) ?? "null");
}

describe("settings sync", () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    cloud.snapshot = null;
    cloud.failure = null;
    cloud.puts = [];
    cloud.clock = 0;
    cloud.fetch.mockReset();
    cloud.fetch.mockImplementation(cloudFetch);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("enabling", () => {
    it("uploads the syncable settings when the cloud has no snapshot", async () => {
      const { sync, useSettingsStore, useSettingsSyncStore } = await loadModules();

      await sync.enableSettingsSync();

      expect(cloud.puts).toHaveLength(1);
      const [put] = cloud.puts;
      expect(put.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(put.settings.fontSize).toBe(useSettingsStore.getState().settings.fontSize);
      expect(put.settings).toHaveProperty("theme");
      expect(put.settings).not.toHaveProperty("windowWidth");
      expect(Object.keys(put.settings).length).toBeGreaterThan(100);
      expect(meta()).toMatchObject({
        enabled: true,
        lastSyncSource: "local",
        lastSyncedAt: cloud.snapshot?.updatedAt,
      });
      expect(useSettingsSyncStore.getState()).toMatchObject({
        enabled: true,
        status: "synced",
        lastSyncSource: "local",
      });
    });

    it("applies a cloud snapshot that is newer than the local edits", async () => {
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({ enabled: false, localUpdatedAt: "2025-06-01T00:00:00.000Z" }),
      );
      cloud.snapshot = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: "2026-02-01T00:00:00.000Z",
        settings: { fontSize: 21, tabSize: 8 },
      };
      const { sync, useSettingsStore, useSettingsSyncStore } = await loadModules();

      await sync.enableSettingsSync();

      expect(cloud.puts).toEqual([]);
      expect(useSettingsStore.getState().settings).toMatchObject({ fontSize: 21, tabSize: 8 });
      expect(useSettingsSyncStore.getState()).toMatchObject({
        status: "synced",
        lastSyncSource: "cloud",
        lastSyncedAt: "2026-02-01T00:00:00.000Z",
      });
      expect(meta()).toMatchObject({
        localUpdatedAt: "2026-02-01T00:00:00.000Z",
        lastSyncSource: "cloud",
      });
    });

    it("accepts a legacy unversioned cloud snapshot", async () => {
      cloud.snapshot = {
        schemaVersion: 0,
        updatedAt: "2026-02-01T00:00:00.000Z",
        settings: { fontSize: 19 },
      };
      const { sync, useSettingsStore } = await loadModules();

      await sync.enableSettingsSync();

      expect(useSettingsStore.getState().settings.fontSize).toBe(19);
    });

    it("keeps local settings when they were edited after the cloud snapshot", async () => {
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({ enabled: false, localUpdatedAt: "2026-05-01T00:00:00.000Z" }),
      );
      cloud.snapshot = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: "2026-02-01T00:00:00.000Z",
        settings: { fontSize: 30 },
      };
      const { sync, useSettingsStore } = await loadModules();
      const localFontSize = useSettingsStore.getState().settings.fontSize;

      await sync.enableSettingsSync();

      expect(useSettingsStore.getState().settings.fontSize).toBe(localFontSize);
      expect(cloud.puts).toHaveLength(1);
      expect(cloud.puts[0].settings.fontSize).toBe(localFontSize);
    });

    it("turns itself back off and reports why when the first sync fails", async () => {
      cloud.failure = { status: 500, error: "Database unavailable" };
      const { sync, useSettingsSyncStore } = await loadModules();

      await expect(sync.enableSettingsSync()).rejects.toThrow("Database unavailable");

      expect(meta()).toMatchObject({ enabled: false });
      expect(useSettingsSyncStore.getState()).toMatchObject({
        enabled: false,
        error: "Database unavailable",
      });
    });

    it("rejects a cloud snapshot that holds no known settings", async () => {
      cloud.snapshot = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: "2026-02-01T00:00:00.000Z",
        settings: { notASetting: true },
      };
      const { sync } = await loadModules();

      await expect(sync.enableSettingsSync()).rejects.toThrow("Could not apply cloud settings.");
      expect(meta()).toMatchObject({ enabled: false });
    });
  });

  describe("after enabling", () => {
    it("pushes local edits once after a 1.5 second debounce", async () => {
      const { sync, useSettingsStore } = await loadModules();
      await sync.enableSettingsSync();
      vi.useFakeTimers();

      await useSettingsStore.getState().actions.updateSetting("fontSize", 17);
      await useSettingsStore.getState().actions.updateSetting("tabSize", 3);
      expect(meta().localUpdatedAt).toEqual(expect.any(String));
      await vi.advanceTimersByTimeAsync(1_499);
      expect(cloud.puts).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(cloud.puts).toHaveLength(2);
      expect(cloud.puts[1].settings).toMatchObject({ fontSize: 17, tabSize: 3 });
    });

    it("records a failed background push as a sync error", async () => {
      const { sync, useSettingsStore, useSettingsSyncStore } = await loadModules();
      await sync.enableSettingsSync();
      vi.useFakeTimers();
      cloud.failure = { status: 503 };

      await useSettingsStore.getState().actions.updateSetting("fontSize", 18);
      await vi.advanceTimersByTimeAsync(1_500);

      expect(useSettingsSyncStore.getState().error).toBe(
        "Failed to update settings sync snapshot: 503",
      );
    });

    it("skips the upload when nothing changed since the last sync", async () => {
      const { sync, useSettingsSyncStore } = await loadModules();
      await sync.enableSettingsSync();
      const lastSyncedAt = meta().lastSyncedAt;

      await sync.syncSettingsNow();

      expect(cloud.puts).toHaveLength(1);
      expect(useSettingsSyncStore.getState()).toMatchObject({ status: "synced", lastSyncedAt });
    });

    it("uploads on demand after a change and surfaces upload failures", async () => {
      const { sync, useSettingsStore } = await loadModules();
      await sync.enableSettingsSync();
      sync.disableSettingsSync();
      await useSettingsStore.getState().actions.updateSetting("fontSize", 22);

      await sync.syncSettingsNow();
      expect(cloud.puts).toHaveLength(2);

      await useSettingsStore.getState().actions.updateSetting("fontSize", 23);
      cloud.failure = { status: 401, error: "expired" };
      await expect(sync.syncSettingsNow()).rejects.toThrow(
        "Cloud settings sync could not access your account. Your session is still signed in.",
      );
    });

    it("stops pushing once disabled", async () => {
      const { sync, useSettingsStore, useSettingsSyncStore } = await loadModules();
      await sync.enableSettingsSync();
      vi.useFakeTimers();

      await useSettingsStore.getState().actions.updateSetting("fontSize", 17);
      sync.disableSettingsSync();
      await vi.advanceTimersByTimeAsync(5_000);

      expect(cloud.puts).toHaveLength(1);
      expect(meta()).toMatchObject({ enabled: false });
      expect(useSettingsSyncStore.getState()).toMatchObject({ enabled: false, status: "disabled" });
    });
  });

  describe("restoring", () => {
    it("restores the cloud snapshot regardless of local edit times", async () => {
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({ enabled: true, localUpdatedAt: "2099-01-01T00:00:00.000Z" }),
      );
      cloud.snapshot = {
        schemaVersion: SETTINGS_SCHEMA_VERSION,
        updatedAt: "2026-02-01T00:00:00.000Z",
        settings: { fontSize: 25 },
      };
      const { sync, useSettingsStore } = await loadModules();

      await sync.restoreSettingsFromCloud();

      expect(useSettingsStore.getState().settings.fontSize).toBe(25);
    });

    it("reports when there is nothing to restore", async () => {
      const { sync, useSettingsSyncStore } = await loadModules();

      await expect(sync.restoreSettingsFromCloud()).rejects.toThrow(
        "No cloud settings snapshot found yet.",
      );
      expect(useSettingsSyncStore.getState().error).toBe("No cloud settings snapshot found yet.");
    });
  });

  describe("startup", () => {
    it("hydrates the sync store from saved preferences and tolerates corrupt data", async () => {
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({
          enabled: true,
          lastSyncedAt: "2026-03-01T00:00:00.000Z",
          lastSyncSource: "cloud",
        }),
      );
      let modules = await loadModules();
      modules.sync.initializeSettingsSyncPreferences();
      expect(modules.useSettingsSyncStore.getState()).toMatchObject({
        enabled: true,
        isHydrated: true,
        lastSyncedAt: "2026-03-01T00:00:00.000Z",
        lastSyncSource: "cloud",
      });

      vi.resetModules();
      window.localStorage.setItem(META_KEY, "{not json");
      modules = await loadModules();
      modules.sync.initializeSettingsSyncPreferences();
      expect(modules.useSettingsSyncStore.getState()).toMatchObject({
        enabled: false,
        lastSyncedAt: null,
        lastSyncSource: null,
      });

      vi.resetModules();
      window.localStorage.setItem(
        META_KEY,
        JSON.stringify({ enabled: "yes", lastSyncedAt: 5, lastSyncSource: "server" }),
      );
      modules = await loadModules();
      modules.sync.initializeSettingsSyncPreferences();
      expect(modules.useSettingsSyncStore.getState()).toMatchObject({
        enabled: false,
        lastSyncedAt: null,
        lastSyncSource: null,
      });
    });

    it.each([
      { isAuthenticated: false, isPro: true },
      { isAuthenticated: true, isPro: false },
    ])("does not sync for %o", async (params) => {
      window.localStorage.setItem(META_KEY, JSON.stringify({ enabled: true }));
      const { sync } = await loadModules();

      await sync.ensureSettingsSyncStarted(params);

      expect(cloud.fetch).not.toHaveBeenCalled();
    });

    it("does not sync when the user never enabled it", async () => {
      const { sync } = await loadModules();

      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });

      expect(cloud.fetch).not.toHaveBeenCalled();
    });

    it("runs the initial sync only once per session", async () => {
      window.localStorage.setItem(META_KEY, JSON.stringify({ enabled: true }));
      const { sync } = await loadModules();

      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });
      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });

      expect(cloud.fetch.mock.calls.filter(([, options]) => !options?.method)).toHaveLength(1);
      expect(cloud.puts).toHaveLength(1);
    });

    it("disables sync when the account session is rejected", async () => {
      window.localStorage.setItem(META_KEY, JSON.stringify({ enabled: true }));
      cloud.failure = { status: 401 };
      const { sync, useSettingsSyncStore } = await loadModules();

      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });

      expect(meta()).toMatchObject({ enabled: false });
      expect(useSettingsSyncStore.getState()).toMatchObject({
        enabled: false,
        error:
          "Cloud settings sync could not access your account. Your session is still signed in.",
      });
    });

    it("keeps sync enabled after a transient failure and retries on the next start", async () => {
      window.localStorage.setItem(META_KEY, JSON.stringify({ enabled: true }));
      cloud.failure = { status: 502 };
      const { sync, useSettingsSyncStore } = await loadModules();

      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });
      expect(meta()).toMatchObject({ enabled: true });
      expect(useSettingsSyncStore.getState().error).toBe(
        "Failed to fetch settings sync snapshot: 502",
      );

      cloud.failure = null;
      await sync.ensureSettingsSyncStarted({ isAuthenticated: true, isPro: true });
      expect(cloud.puts).toHaveLength(1);
    });
  });
});
