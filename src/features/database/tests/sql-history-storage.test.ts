import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  getSqlHistoryStorageKey,
  loadSqlHistory,
  saveSqlHistory,
} from "@/features/database/lib/sql-history-storage";

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

describe("sql history storage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads trimmed unique valid entries from saved history", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(
      getSqlHistoryStorageKey("postgres", "connection", "pg-local"),
      JSON.stringify([" select 1 ", "", null, "select 2", "select\n1", "select 2;"]),
    );

    expect(loadSqlHistory("postgres", "connection", "pg-local")).toEqual(["select 1", "select 2"]);
  });

  it("deduplicates saved history by visible preview after leading comments", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(
      getSqlHistoryStorageKey("postgres", "connection", "pg-local"),
      JSON.stringify([
        "-- dashboard\nselect * from users",
        "/* copied from issue */\nselect * from users;",
        "select * from teams",
      ]),
    );

    expect(loadSqlHistory("postgres", "connection", "pg-local")).toEqual([
      "-- dashboard\nselect * from users",
      "select * from teams",
    ]);
  });

  it("returns empty history for malformed saved values", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(getSqlHistoryStorageKey("sqlite", "file", "/tmp/app.sqlite"), "{");

    expect(loadSqlHistory("sqlite", "file", "/tmp/app.sqlite")).toEqual([]);
  });

  it("saves normalized history and removes empty history", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("localStorage", storage);
    const storageKey = getSqlHistoryStorageKey("mysql", "connection", "mysql-local");

    saveSqlHistory("mysql", "connection", "mysql-local", [
      " select 1 ",
      "",
      "select 2",
      "select\n1",
      "select 2;",
    ]);

    expect(JSON.parse(storage.getItem(storageKey) ?? "[]")).toEqual(["select 1", "select 2"]);

    saveSqlHistory("mysql", "connection", "mysql-local", ["   "]);

    expect(storage.getItem(storageKey)).toBeNull();
  });
});
