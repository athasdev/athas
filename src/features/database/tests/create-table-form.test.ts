import { describe, expect, it } from "vite-plus/test";
import {
  getInitialCreateTableColumn,
  normalizeCreateTableColumns,
} from "../utils/create-table-form";

describe("create table form", () => {
  it("provides a default text column draft", () => {
    expect(getInitialCreateTableColumn()).toEqual({
      name: "",
      type: "TEXT",
      notnull: false,
    });
  });

  it("trims and drops empty column drafts before submit", () => {
    expect(
      normalizeCreateTableColumns([
        { name: " id ", type: "INTEGER", notnull: true },
        { name: "   ", type: "TEXT", notnull: false },
      ]),
    ).toEqual([{ name: "id", type: "INTEGER", notnull: true }]);
  });

  it("normalizes column types before submit", () => {
    expect(
      normalizeCreateTableColumns([
        { name: "id", type: " INTEGER ", notnull: true },
        { name: "notes", type: "   ", notnull: false },
      ]),
    ).toEqual([
      { name: "id", type: "INTEGER", notnull: true },
      { name: "notes", type: "TEXT", notnull: false },
    ]);
  });

  it("drops duplicate column drafts case-insensitively", () => {
    expect(
      normalizeCreateTableColumns([
        { name: "id", type: "INTEGER", notnull: true },
        { name: " ID ", type: "TEXT", notnull: false },
        { name: "email", type: "TEXT", notnull: false },
      ]),
    ).toEqual([
      { name: "id", type: "INTEGER", notnull: true },
      { name: "email", type: "TEXT", notnull: false },
    ]);
  });
});
