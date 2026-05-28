import { describe, expect, it } from "vite-plus/test";
import {
  addSqlHistoryEntry,
  formatSqlHistoryPreview,
  removeSqlHistoryEntry,
  useSqlHistoryEntry,
} from "./sql-history";

describe("sql history", () => {
  it("adds new queries to the front", () => {
    expect(addSqlHistoryEntry(["select 1"], "select 2")).toEqual(["select 2", "select 1"]);
  });

  it("moves repeated queries to the front", () => {
    expect(addSqlHistoryEntry(["select 1", "select 2", "select 3"], "select 2")).toEqual([
      "select 2",
      "select 1",
      "select 3",
    ]);
  });

  it("deduplicates queries by collapsed whitespace", () => {
    expect(
      addSqlHistoryEntry(
        ["select * from users where id = 1", "select * from teams"],
        " select *\nfrom users\twhere id = 1 ",
      ),
    ).toEqual(["select *\nfrom users\twhere id = 1", "select * from teams"]);
  });

  it("deduplicates equivalent queries with trailing semicolons", () => {
    expect(addSqlHistoryEntry(["select 1", "select 2"], "select 1;")).toEqual([
      "select 1;",
      "select 2",
    ]);
    expect(addSqlHistoryEntry(["select 1;", "select 2"], "select 1")).toEqual([
      "select 1",
      "select 2",
    ]);
  });

  it("deduplicates queries by the visible preview after leading comments", () => {
    expect(
      addSqlHistoryEntry(
        ["-- dashboard\nselect * from users", "select * from teams"],
        "/* copied from issue */\nselect * from users;",
      ),
    ).toEqual(["/* copied from issue */\nselect * from users;", "select * from teams"]);
  });

  it("trims and limits history", () => {
    const history = Array.from({ length: 10 }, (_, index) => `select ${index}`);

    expect(addSqlHistoryEntry(history, "  select 10  ")).toEqual([
      "select 10",
      "select 0",
      "select 1",
      "select 2",
      "select 3",
      "select 4",
      "select 5",
      "select 6",
      "select 7",
      "select 8",
    ]);
  });

  it("removes a query from history", () => {
    expect(removeSqlHistoryEntry(["select 1", "select 2"], "select 1")).toEqual(["select 2"]);
  });

  it("removes a query by normalized text", () => {
    expect(removeSqlHistoryEntry([" select 1 ", "select 2"], "select 1")).toEqual(["select 2"]);
  });

  it("removes a query by collapsed whitespace", () => {
    expect(
      removeSqlHistoryEntry(["select *\nfrom users", "select * from teams"], "select * from users"),
    ).toEqual(["select * from teams"]);
  });

  it("removes a query by optional trailing semicolon", () => {
    expect(removeSqlHistoryEntry(["select 1;", "select 2"], "select 1")).toEqual(["select 2"]);
  });

  it("removes a query by visible preview after leading comments", () => {
    expect(
      removeSqlHistoryEntry(
        ["-- dashboard\nselect * from users", "select * from teams"],
        "select * from users",
      ),
    ).toEqual(["select * from teams"]);
  });

  it("promotes a reused history entry", () => {
    expect(useSqlHistoryEntry(["select 1", "select 2", "select 3"], "select 3")).toEqual([
      "select 3",
      "select 1",
      "select 2",
    ]);
  });

  it("promotes a reused history entry by normalized text", () => {
    expect(useSqlHistoryEntry(["select 1", " select 2 ", "select 3"], "select 2")).toEqual([
      "select 2",
      "select 1",
      "select 3",
    ]);
  });

  it("promotes a reused history entry by collapsed whitespace", () => {
    expect(
      useSqlHistoryEntry(["select * from teams", "select *\nfrom users"], "select * from users"),
    ).toEqual(["select * from users", "select * from teams"]);
  });

  it("promotes a reused history entry by optional trailing semicolon", () => {
    expect(useSqlHistoryEntry(["select 1;", "select 2"], "select 1")).toEqual([
      "select 1",
      "select 2",
    ]);
  });

  it("promotes a reused history entry by visible preview after leading comments", () => {
    expect(
      useSqlHistoryEntry(
        ["-- dashboard\nselect * from users", "select * from teams"],
        "select * from users",
      ),
    ).toEqual(["select * from users", "select * from teams"]);
  });

  it("leaves unknown history entries unchanged", () => {
    const history = ["select 1", "select 2"];
    expect(useSqlHistoryEntry(history, "select 3")).toBe(history);
  });

  it("formats multiline query previews", () => {
    expect(formatSqlHistoryPreview(" select *\n from users\twhere id = 1 ")).toBe(
      "select * from users where id = 1",
    );
  });

  it("skips leading SQL comments in query previews", () => {
    expect(formatSqlHistoryPreview("-- explain this query\nselect * from users")).toBe(
      "select * from users",
    );
    expect(formatSqlHistoryPreview("# explain this query\nselect * from users")).toBe(
      "select * from users",
    );
    expect(formatSqlHistoryPreview("/* dashboard query */\nselect count(*) from users")).toBe(
      "select count(*) from users",
    );
  });

  it("keeps comment-only queries previewable", () => {
    expect(formatSqlHistoryPreview("-- explain this query")).toBe("-- explain this query");
    expect(formatSqlHistoryPreview("# explain this query")).toBe("# explain this query");
    expect(formatSqlHistoryPreview("/* unterminated")).toBe("/* unterminated");
  });

  it("truncates long query previews", () => {
    const query =
      "select id, name, email, created_at, updated_at, deleted_at, role, status from users where status = 'active'";

    expect(formatSqlHistoryPreview(query)).toBe(
      "select id, name, email, created_at, updated_at, deleted_at, role, status from users where…",
    );
  });

  it("keeps context when truncating long queries without spaces", () => {
    const query = "select_" + "very_long_identifier_".repeat(8);

    expect(formatSqlHistoryPreview(query)).toBe(
      "select_very_long_identifier_very_long_identifier_very_long_identifier_very_long_identifier_very…",
    );
  });
});
