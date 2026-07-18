import { describe, expect, it } from "vite-plus/test";
import {
  formatForeignKeyLabel,
  getColumnConstraintLabels,
  mapForeignKeysByColumn,
} from "@/features/database/lib/database-schema";

describe("database schema helpers", () => {
  it("formats column constraint labels in stable order", () => {
    expect(
      getColumnConstraintLabels({
        name: "id",
        type: "INTEGER",
        notnull: true,
        default_value: "nextval('users_id_seq')",
        primary_key: true,
      }),
    ).toEqual(["PK", "NN", "def: nextval('users_id_seq')"]);
  });

  it("omits absent column constraints", () => {
    expect(
      getColumnConstraintLabels({
        name: "name",
        type: "TEXT",
        notnull: false,
        default_value: null,
        primary_key: false,
      }),
    ).toEqual([]);
  });

  it("keeps empty string default values visible", () => {
    expect(
      getColumnConstraintLabels({
        name: "nickname",
        type: "TEXT",
        notnull: false,
        default_value: "",
        primary_key: false,
      }),
    ).toEqual(["def: "]);
  });

  it("formats and indexes foreign keys by source column", () => {
    const foreignKeys = [
      { from_column: "user_id", to_table: "users", to_column: "id" },
      { from_column: "team_id", to_table: "teams", to_column: "id" },
    ];

    expect(formatForeignKeyLabel(foreignKeys[0])).toBe("FK users.id");
    expect(mapForeignKeysByColumn(foreignKeys).get("team_id")).toEqual(foreignKeys[1]);
  });

  it("normalizes foreign key metadata before formatting and indexing", () => {
    const foreignKeys = [
      { from_column: " user_id ", to_table: " users ", to_column: " id " },
      { from_column: " ", to_table: "teams", to_column: "id" },
      { from_column: "team_id", to_table: "", to_column: "id" },
    ];

    expect(formatForeignKeyLabel(foreignKeys[0])).toBe("FK users.id");
    expect(mapForeignKeysByColumn(foreignKeys)).toEqual(
      new Map([
        [
          "user_id",
          {
            from_column: "user_id",
            to_table: "users",
            to_column: "id",
          },
        ],
      ]),
    );
  });

  it("keeps the first foreign key when duplicate source columns are reported", () => {
    const foreignKeys = [
      { from_column: "owner_id", to_table: "users", to_column: "id" },
      { from_column: " owner_id ", to_table: "accounts", to_column: "id" },
    ];

    expect(mapForeignKeysByColumn(foreignKeys).get("owner_id")).toEqual(foreignKeys[0]);
  });
});
