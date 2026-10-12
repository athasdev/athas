import { describe, expect, it } from "vite-plus/test";
import { getSqlCompletions } from "@/features/database/lib/sql-completions";

const context = { tables: [{ name: "users" }], columns: [] };

function suggestionsAtEnd(sql: string) {
  return getSqlCompletions(sql, sql.length, context).items.map((item) => item.value);
}

describe("sql completions after closed literals and comments", () => {
  it.each([
    { label: "a line comment", sql: "-- note\nsel" },
    { label: "a dollar-quoted body", sql: "select $$ body $$ sel" },
    { label: "a tagged dollar-quoted body", sql: "select $fn$ x $fn$ sel" },
    { label: "a single-quoted string with an escaped quote", sql: "select 'it''s' sel" },
    { label: "a double-quoted identifier with an escaped quote", sql: 'select "a""b" sel' },
    { label: "a backtick identifier with an escaped backtick", sql: "select `a``b` sel" },
  ])("suggests again after $label", ({ sql }) => {
    expect(suggestionsAtEnd(sql)).toContain("SELECT");
  });

  it("keeps a lone dollar sign as part of the word", () => {
    expect(
      getSqlCompletions("select $1 + use", 15, context).items.map((item) => item.value),
    ).toContain("users");
  });
});
