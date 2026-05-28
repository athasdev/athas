import { describe, expect, it } from "vite-plus/test";
import { buildSqlHighlightSegments } from "./sql-highlight";

describe("sql highlight segments", () => {
  it("splits SQL into plain and tokenized segments", () => {
    expect(
      buildSqlHighlightSegments("select name from users", [
        { start: 0, end: 6, class_name: "token-keyword" },
        { start: 12, end: 16, class_name: "token-keyword" },
      ]),
    ).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " name " },
      { text: "from", className: "token-keyword" },
      { text: " users" },
    ]);
  });

  it("clips invalid and overlapping tokens to the visible SQL text", () => {
    expect(
      buildSqlHighlightSegments("select 1", [
        { start: 0, end: 20, class_name: "token-keyword" },
        { start: 1, end: 6, class_name: "token-function" },
        { start: 30, end: 35, class_name: "token-string" },
      ]),
    ).toEqual([{ text: "select 1", className: "token-keyword" }]);
  });

  it("ignores malformed tokenizer ranges", () => {
    expect(
      buildSqlHighlightSegments("select 1", [
        { start: 5, end: 3, class_name: "token-keyword" },
        { start: Number.NaN, end: 6, class_name: "token-function" },
        { start: 7, end: 8, class_name: "token-number" },
      ]),
    ).toEqual([{ text: "select " }, { text: "1", className: "token-number" }]);
  });

  it("falls back to lexical SQL highlighting when tokenizer tokens are missing", () => {
    expect(buildSqlHighlightSegments("select 'Ada', 42 from users -- active", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "'Ada'", className: "token-string" },
      { text: ", " },
      { text: "42", className: "token-number" },
      { text: " " },
      { text: "from", className: "token-keyword" },
      { text: " users " },
      { text: "-- active", className: "token-comment" },
    ]);
  });

  it("highlights MySQL hash comments in fallback mode", () => {
    expect(buildSqlHighlightSegments("select 1 # active\nfrom users", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "1", className: "token-number" },
      { text: " " },
      { text: "# active", className: "token-comment" },
      { text: "\n" },
      { text: "from", className: "token-keyword" },
      { text: " users" },
    ]);
  });

  it("highlights scientific numeric literals in fallback mode", () => {
    expect(buildSqlHighlightSegments("select 1e-3, 2.5E4 from metrics", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "1e-3", className: "token-number" },
      { text: ", " },
      { text: "2.5E4", className: "token-number" },
      { text: " " },
      { text: "from", className: "token-keyword" },
      { text: " metrics" },
    ]);
  });

  it("highlights PostgreSQL dollar-quoted strings in fallback mode", () => {
    expect(
      buildSqlHighlightSegments("select $$from users$$, $tag$select$tag$ from logs", []),
    ).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "$$from users$$", className: "token-string" },
      { text: ", " },
      { text: "$tag$select$tag$", className: "token-string" },
      { text: " " },
      { text: "from", className: "token-keyword" },
      { text: " logs" },
    ]);
  });

  it("requires matching PostgreSQL dollar quote tags in fallback mode", () => {
    expect(
      buildSqlHighlightSegments("select $body$from $other$ table$body$ from logs", []),
    ).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "$body$from $other$ table$body$", className: "token-string" },
      { text: " " },
      { text: "from", className: "token-keyword" },
      { text: " logs" },
    ]);
  });

  it("keeps quoted identifiers out of fallback keyword highlighting", () => {
    expect(buildSqlHighlightSegments('select "from" from users', [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: ' "from" ' },
      { text: "from", className: "token-keyword" },
      { text: " users" },
    ]);
  });

  it("keeps backtick identifiers out of fallback keyword highlighting", () => {
    expect(buildSqlHighlightSegments("select `from`, `user``table` from users", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " `from`, `user``table` " },
      { text: "from", className: "token-keyword" },
      { text: " users" },
    ]);
  });

  it("highlights unfinished SQL tokens while editing", () => {
    expect(buildSqlHighlightSegments("select 'Ada", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "'Ada", className: "token-string" },
    ]);
    expect(buildSqlHighlightSegments("select /* active", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "/* active", className: "token-comment" },
    ]);
    expect(buildSqlHighlightSegments("select `from", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " `from" },
    ]);
    expect(buildSqlHighlightSegments("select $$from", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "$$from", className: "token-string" },
    ]);
  });

  it("highlights extended SQL keywords in fallback mode", () => {
    expect(
      buildSqlHighlightSegments(
        "select * from users union all select * from archived offset 10",
        [],
      ),
    ).toContainEqual({
      text: "union",
      className: "token-keyword",
    });
    expect(
      buildSqlHighlightSegments("insert into users(name) values('Ada') returning id", []),
    ).toContainEqual({
      text: "returning",
      className: "token-keyword",
    });
    expect(
      buildSqlHighlightSegments("select * from users union all select * from logs", []),
    ).toContainEqual({
      text: "all",
      className: "token-keyword",
    });
    expect(
      buildSqlHighlightSegments(
        "create table users (id integer primary key, team_id integer references teams(id), active boolean default true)",
        [],
      ),
    ).toEqual(
      expect.arrayContaining([
        { text: "create", className: "token-keyword" },
        { text: "table", className: "token-keyword" },
        { text: "integer", className: "token-keyword" },
        { text: "primary", className: "token-keyword" },
        { text: "key", className: "token-keyword" },
        { text: "references", className: "token-keyword" },
        { text: "boolean", className: "token-keyword" },
        { text: "default", className: "token-keyword" },
        { text: "true", className: "token-keyword" },
      ]),
    );
    expect(
      buildSqlHighlightSegments(
        "select * from users where email ilike '%@athas.dev' and exists (select 1)",
        [],
      ),
    ).toEqual(
      expect.arrayContaining([
        { text: "ilike", className: "token-keyword" },
        { text: "exists", className: "token-keyword" },
      ]),
    );
  });

  it("highlights SQL DDL data types in fallback mode", () => {
    const segments = buildSqlHighlightSegments(
      "create table events (id uuid default gen_random_uuid(), payload jsonb, name varchar(255), notes text, count bigint, created_at timestamp)",
      [],
    );

    expect(segments).toEqual(
      expect.arrayContaining([
        { text: "uuid", className: "token-keyword" },
        { text: "default", className: "token-keyword" },
        { text: "gen_random_uuid", className: "token-function" },
        { text: "jsonb", className: "token-keyword" },
        { text: "varchar", className: "token-keyword" },
        { text: "text", className: "token-keyword" },
        { text: "bigint", className: "token-keyword" },
        { text: "timestamp", className: "token-keyword" },
      ]),
    );
  });

  it("highlights SQL aggregate functions in fallback mode", () => {
    expect(buildSqlHighlightSegments("select count(*), sum(total) from orders", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "count", className: "token-function" },
      { text: "(" },
      { text: "*", className: "token-operator" },
      { text: "), " },
      { text: "sum", className: "token-function" },
      { text: "(total) " },
      { text: "from", className: "token-keyword" },
      { text: " orders" },
    ]);
  });

  it("highlights CTE and window query syntax in fallback mode", () => {
    const segments = buildSqlHighlightSegments(
      "with ranked as (select row_number() over (partition by team_id order by score desc) from scores) select coalesce(score, 0) from ranked",
      [],
    );

    expect(segments).toContainEqual({ text: "with", className: "token-keyword" });
    expect(segments).toContainEqual({ text: "row_number", className: "token-function" });
    expect(segments).toContainEqual({ text: "over", className: "token-keyword" });
    expect(segments).toContainEqual({ text: "partition", className: "token-keyword" });
    expect(segments).toContainEqual({ text: "coalesce", className: "token-function" });
  });

  it("highlights SQL bind parameters in fallback mode", () => {
    expect(
      buildSqlHighlightSegments(
        "select * from users where id = $1 and email = :email and team = @team or active = ?",
        [],
      ),
    ).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " " },
      { text: "*", className: "token-operator" },
      { text: " " },
      { text: "from", className: "token-keyword" },
      { text: " users " },
      { text: "where", className: "token-keyword" },
      { text: " id " },
      { text: "=", className: "token-operator" },
      { text: " " },
      { text: "$1", className: "token-variable" },
      { text: " " },
      { text: "and", className: "token-keyword" },
      { text: " email " },
      { text: "=", className: "token-operator" },
      { text: " " },
      { text: ":email", className: "token-variable" },
      { text: " " },
      { text: "and", className: "token-keyword" },
      { text: " team " },
      { text: "=", className: "token-operator" },
      { text: " " },
      { text: "@team", className: "token-variable" },
      { text: " " },
      { text: "or", className: "token-keyword" },
      { text: " active " },
      { text: "=", className: "token-operator" },
      { text: " " },
      { text: "?", className: "token-variable" },
    ]);
  });

  it("highlights SQL operators in fallback mode", () => {
    expect(
      buildSqlHighlightSegments(
        "select payload->>'name' from events where score >= 10 and deleted_at is not null",
        [],
      ),
    ).toEqual(
      expect.arrayContaining([
        { text: "->>", className: "token-operator" },
        { text: ">=", className: "token-operator" },
      ]),
    );
    expect(buildSqlHighlightSegments("select created_at::date from events", [])).toContainEqual({
      text: "::",
      className: "token-operator",
    });
  });

  it("does not treat PostgreSQL casts as bind parameters in fallback mode", () => {
    expect(buildSqlHighlightSegments("select created_at::date from events", [])).toEqual([
      { text: "select", className: "token-keyword" },
      { text: " created_at" },
      { text: "::", className: "token-operator" },
      { text: "date " },
      { text: "from", className: "token-keyword" },
      { text: " events" },
    ]);
  });

  it("keeps an empty editor line renderable", () => {
    expect(buildSqlHighlightSegments("", [])).toEqual([{ text: " " }]);
  });
});
