import { describe, expect, it } from "vite-plus/test";
import { applySqlCompletion, getSqlCompletions } from "./sql-completions";

const context = {
  tables: [
    { name: "users" },
    { name: "active_users", kind: "view" as const },
    { name: "daily_metrics", kind: "materialized_view" as const },
    { name: "users_email_idx", kind: "index" as const, table_name: "users" },
    { name: "sub_events", kind: "subscription" as const },
  ],
  columns: [
    { name: "id", type: "INTEGER", notnull: true, default_value: null, primary_key: true },
    { name: "email", type: "TEXT", notnull: false, default_value: null, primary_key: false },
  ],
};

describe("sql completions", () => {
  it("does not open suggestions for an empty prefix", () => {
    expect(getSqlCompletions("select * from ", 14, context).items).toEqual([]);
  });

  it("normalizes invalid cursor positions", () => {
    expect(getSqlCompletions("select", Number.NaN, context)).toEqual({
      prefix: "",
      start: 0,
      end: 6,
      items: [],
    });
    expect(getSqlCompletions("select", 999, context).start).toBe(0);
  });

  it("suggests SQL keywords by cursor prefix", () => {
    expect(getSqlCompletions("sel", 3, context).items.map((item) => item.value)).toContain(
      "SELECT",
    );
    expect(getSqlCompletions("ret", 3, context).items.map((item) => item.value)).toContain(
      "RETURNING",
    );
    expect(getSqlCompletions("uni", 3, context).items.map((item) => item.value)).toEqual([
      "UNION",
      "UNION ALL",
    ]);
    expect(getSqlCompletions("wit", 3, context).items).toContainEqual({
      value: "WITH",
      label: "WITH",
      detail: "keyword",
    });
    expect(getSqlCompletions("par", 3, context).items).toContainEqual({
      value: "PARTITION BY",
      label: "PARTITION BY",
      detail: "keyword",
    });
    expect(getSqlCompletions("rig", 3, context).items).toContainEqual({
      value: "RIGHT JOIN",
      label: "RIGHT JOIN",
      detail: "keyword",
    });
    expect(getSqlCompletions("hav", 3, context).items).toContainEqual({
      value: "HAVING",
      label: "HAVING",
      detail: "keyword",
    });
    expect(getSqlCompletions("dis", 3, context).items).toContainEqual({
      value: "DISTINCT",
      label: "DISTINCT",
      detail: "keyword",
    });
    expect(getSqlCompletions("ili", 3, context).items).toContainEqual({
      value: "ILIKE",
      label: "ILIKE",
      detail: "keyword",
    });
    expect(getSqlCompletions("exi", 3, context).items).toContainEqual({
      value: "EXISTS",
      label: "EXISTS",
      detail: "keyword",
    });
    expect(getSqlCompletions("pri", 3, context).items).toContainEqual({
      value: "PRIMARY KEY",
      label: "PRIMARY KEY",
      detail: "keyword",
    });
    expect(getSqlCompletions("ref", 3, context).items).toContainEqual({
      value: "REFERENCES",
      label: "REFERENCES",
      detail: "keyword",
    });
    expect(getSqlCompletions("tru", 3, context).items).toContainEqual({
      value: "TRUE",
      label: "TRUE",
      detail: "keyword",
    });
    expect(getSqlCompletions("is", 2, context).items).toEqual([
      { value: "IS NULL", label: "IS NULL", detail: "keyword" },
      { value: "IS NOT NULL", label: "IS NOT NULL", detail: "keyword" },
    ]);
  });

  it("suggests SQL functions by cursor prefix", () => {
    expect(getSqlCompletions("coa", 3, context).items).toContainEqual({
      value: "COALESCE",
      label: "COALESCE",
      detail: "function",
    });
    expect(getSqlCompletions("row", 3, context).items).toContainEqual({
      value: "ROW_NUMBER",
      label: "ROW_NUMBER",
      detail: "function",
    });
  });

  it("suggests queryable object and column names but skips catalog-only objects", () => {
    const suggestions = getSqlCompletions("u", 1, context).items.map((item) => item.value);

    expect(suggestions).toContain("users");
    expect(getSqlCompletions("daily", 5, context).items.map((item) => item.value)).toContain(
      "daily_metrics",
    );
    expect(suggestions).not.toContain("users_email_idx");
    expect(getSqlCompletions("sub", 3, context).items.map((item) => item.value)).not.toContain(
      "sub_events",
    );

    expect(getSqlCompletions("em", 2, context).items).toContainEqual({
      value: "email",
      label: "email",
      detail: "column",
    });
  });

  it("suggests columns after a dotted qualifier without opening global suggestions", () => {
    expect(getSqlCompletions("select users.", 13, context).items).toEqual([
      { value: "id", label: "id", detail: "column" },
      { value: "email", label: "email", detail: "column" },
    ]);

    expect(getSqlCompletions("select users.e", 14, context).items).toEqual([
      { value: "email", label: "email", detail: "column" },
    ]);
  });

  it("does not suggest completions inside SQL strings or comments", () => {
    expect(getSqlCompletions("select 'us", 10, context).items).toEqual([]);
    expect(getSqlCompletions("select 'Ada''s us", 16, context).items).toEqual([]);
    expect(getSqlCompletions('select "us', 10, context).items).toEqual([]);
    expect(getSqlCompletions('select "user""s us', 17, context).items).toEqual([]);
    expect(getSqlCompletions("select `us", 10, context).items).toEqual([]);
    expect(getSqlCompletions("select `user``s us", 17, context).items).toEqual([]);
    expect(getSqlCompletions("select $$us", 11, context).items).toEqual([]);
    expect(getSqlCompletions("select $tag$us", 14, context).items).toEqual([]);
    expect(getSqlCompletions("-- sel", 6, context).items).toEqual([]);
    expect(getSqlCompletions("# sel", 5, context).items).toEqual([]);
    expect(getSqlCompletions("/* sel", 6, context).items).toEqual([]);
    expect(
      getSqlCompletions("/* sel */\nsel", 13, context).items.map((item) => item.value),
    ).toContain("SELECT");
    expect(getSqlCompletions("# sel\nsel", 9, context).items.map((item) => item.value)).toContain(
      "SELECT",
    );
  });

  it("replaces the word at the cursor with a selected completion", () => {
    const state = getSqlCompletions("select * from us where id = 1", 16, context);

    expect(applySqlCompletion("select * from us where id = 1", state.items[0], state)).toEqual({
      value: "select * from users where id = 1",
      cursor: 19,
    });
  });

  it("normalizes invalid replacement ranges before applying a completion", () => {
    expect(
      applySqlCompletion(
        "select us",
        { value: "users", label: "users", detail: "table" },
        { start: 9, end: 7 },
      ),
    ).toEqual({
      value: "select users",
      cursor: 12,
    });

    expect(
      applySqlCompletion(
        "select us",
        { value: "users", label: "users", detail: "table" },
        { start: Number.NaN, end: Number.NaN },
      ),
    ).toEqual({
      value: "usersselect us",
      cursor: 5,
    });
  });
});
