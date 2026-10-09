// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

interface FakeRequest {
  result?: unknown;
  transaction?: { abort: () => void } | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onblocked?: (() => void) | null;
  onupgradeneeded?: (() => void) | null;
}

interface FakeDatabaseState {
  exists: boolean;
  hasParserStore: boolean;
  rows: unknown[];
  failOpen?: boolean;
  failRead?: boolean;
  deleted: number;
  closed: number;
}

function createFakeIndexedDb(state: FakeDatabaseState) {
  const later = (callback: () => void) => setTimeout(callback, 0);
  return {
    open: () => {
      const request: FakeRequest = { onsuccess: null, onerror: null, onupgradeneeded: null };
      later(() => {
        if (state.failOpen) {
          request.onerror?.();
          return;
        }
        if (!state.exists) {
          request.transaction = { abort: () => undefined };
          request.onupgradeneeded?.();
        }
        request.result = {
          objectStoreNames: { contains: () => state.exists && state.hasParserStore },
          close: () => {
            state.closed++;
          },
          transaction: () => ({
            objectStore: () => ({
              getAll: () => {
                const read: FakeRequest = { onsuccess: null, onerror: null };
                later(() => {
                  if (state.failRead) {
                    read.onerror?.();
                    return;
                  }
                  read.result = state.rows;
                  read.onsuccess?.();
                });
                return read;
              },
            }),
          }),
        };
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase: () => {
      const request: FakeRequest = { onsuccess: null, onerror: null, onblocked: null };
      later(() => {
        state.deleted++;
        state.exists = false;
        request.onsuccess?.();
      });
      return request;
    },
  };
}

let database: FakeDatabaseState;

async function loadInstalledLanguages() {
  vi.resetModules();
  return (await import("../installer/installed-languages")).installedLanguages;
}

beforeEach(() => {
  localStorage.clear();
  database = { exists: false, hasParserStore: false, rows: [], deleted: 0, closed: 0 };
  vi.stubGlobal("indexedDB", createFakeIndexedDb(database));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("installed language integrations", () => {
  it("records installs, replaces reinstalls, and forgets uninstalled languages", async () => {
    const installedLanguages = await loadInstalledLanguages();

    await installedLanguages.add({
      languageId: "rust",
      extensionId: "athas.rust",
      version: "1.0.0",
    });
    await installedLanguages.add({ languageId: "go", version: "1.0.0" });
    await installedLanguages.add({
      languageId: "rust",
      extensionId: "athas.rust",
      version: "1.1.0",
    });

    expect(
      (await installedLanguages.list()).map(({ languageId, version }) => [languageId, version]),
    ).toEqual([
      ["go", "1.0.0"],
      ["rust", "1.1.0"],
    ]);

    await installedLanguages.uninstall("go");
    expect((await installedLanguages.list()).map(({ languageId }) => languageId)).toEqual(["rust"]);
  });

  it("ignores corrupt or malformed stored entries", async () => {
    const installedLanguages = await loadInstalledLanguages();

    localStorage.setItem("athas.installedLanguages", "{broken");
    expect(await installedLanguages.list()).toEqual([]);

    localStorage.setItem("athas.installedLanguages", JSON.stringify({ languageId: "rust" }));
    expect(await installedLanguages.list()).toEqual([]);

    localStorage.setItem(
      "athas.installedLanguages",
      JSON.stringify([{ languageId: "rust", version: "1.0.0", installedAt: 1 }, { languageId: 2 }]),
    );
    expect((await installedLanguages.list()).map(({ languageId }) => languageId)).toEqual(["rust"]);
  });

  it("moves installs recorded in the legacy parser cache once and deletes the cache", async () => {
    database.exists = true;
    database.hasParserStore = true;
    database.rows = [
      { languageId: "python", extensionId: "athas.python", version: "2.0.0", downloadedAt: 42 },
      { languageId: "rust" },
      { notALanguage: true },
    ];
    localStorage.setItem(
      "athas.installedLanguages",
      JSON.stringify([{ languageId: "rust", version: "3.0.0", installedAt: 1 }]),
    );
    const installedLanguages = await loadInstalledLanguages();

    const languages = await installedLanguages.list();
    await installedLanguages.list();

    expect(languages).toEqual([
      { languageId: "rust", version: "3.0.0", installedAt: 1 },
      { languageId: "python", extensionId: "athas.python", version: "2.0.0", installedAt: 42 },
    ]);
    expect(database.deleted).toBe(1);
    expect(database.closed).toBe(1);
  });

  it("skips migration when the legacy cache is missing or unreadable", async () => {
    let installedLanguages = await loadInstalledLanguages();
    expect(await installedLanguages.list()).toEqual([]);
    expect(database.deleted).toBe(1);

    database.exists = true;
    database.hasParserStore = false;
    installedLanguages = await loadInstalledLanguages();
    expect(await installedLanguages.list()).toEqual([]);

    database.exists = true;
    database.hasParserStore = true;
    database.failRead = true;
    installedLanguages = await loadInstalledLanguages();
    expect(await installedLanguages.list()).toEqual([]);

    database.failOpen = true;
    installedLanguages = await loadInstalledLanguages();
    expect(await installedLanguages.list()).toEqual([]);
    expect(database.deleted).toBe(4);
  });

  it("keeps working when the migration itself fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("indexedDB disabled");
      },
    });
    const installedLanguages = await loadInstalledLanguages();

    await installedLanguages.add({ languageId: "zig", version: "0.1.0" });

    expect((await installedLanguages.list()).map(({ languageId }) => languageId)).toEqual(["zig"]);
    expect(console.warn).toHaveBeenCalledWith(
      "Failed to migrate installed language integrations:",
      expect.any(Error),
    );
  });
});
