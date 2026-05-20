import { beforeEach, describe, expect, it } from "vite-plus/test";
import { getSqlHistoryStorageKey, loadSqlHistory, saveSqlHistory } from "./sql-history-storage";

describe("sql history storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("loads trimmed unique valid entries from saved history", () => {
    localStorage.setItem(
      getSqlHistoryStorageKey("postgres", "connection", "pg-local"),
      JSON.stringify([" select 1 ", "", null, "select 2", "select\n1", "select 2;"]),
    );

    expect(loadSqlHistory("postgres", "connection", "pg-local")).toEqual(["select 1", "select 2"]);
  });

  it("deduplicates saved history by visible preview after leading comments", () => {
    localStorage.setItem(
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
    localStorage.setItem(getSqlHistoryStorageKey("sqlite", "file", "/tmp/app.sqlite"), "{");

    expect(loadSqlHistory("sqlite", "file", "/tmp/app.sqlite")).toEqual([]);
  });

  it("saves normalized history and removes empty history", () => {
    const storageKey = getSqlHistoryStorageKey("mysql", "connection", "mysql-local");

    saveSqlHistory("mysql", "connection", "mysql-local", [
      " select 1 ",
      "",
      "select 2",
      "select\n1",
      "select 2;",
    ]);

    expect(JSON.parse(localStorage.getItem(storageKey) ?? "[]")).toEqual(["select 1", "select 2"]);

    saveSqlHistory("mysql", "connection", "mysql-local", ["   "]);

    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
