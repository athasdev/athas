import { describe, expect, it } from "vite-plus/test";
import {
  getDatabaseObjectOwner,
  groupDatabaseObjects,
  getDatabaseObjectKind,
} from "@/features/database/lib/database-catalog";
import type { TableInfo } from "../types/common.types";

describe("database catalog helpers", () => {
  it("groups database objects in stable UI order", () => {
    const objects: TableInfo[] = [
      { name: "users2" },
      { name: "users_name_idx", kind: "index", table_name: "users" },
      { name: "active_users", kind: "view" },
      { name: "daily_metrics", kind: "materialized_view" },
      { name: "Users10" },
      { name: "users1" },
      { name: "sub_events", kind: "subscription" },
    ];

    expect(groupDatabaseObjects(objects)).toEqual([
      {
        kind: "table",
        label: "Tables",
        objects: [{ name: "users1" }, { name: "users2" }, { name: "Users10" }],
      },
      { kind: "view", label: "Views", objects: [{ name: "active_users", kind: "view" }] },
      {
        kind: "materialized_view",
        label: "Materialized Views",
        objects: [{ name: "daily_metrics", kind: "materialized_view" }],
      },
      {
        kind: "subscription",
        label: "Subscriptions",
        objects: [{ name: "sub_events", kind: "subscription" }],
      },
      {
        kind: "index",
        label: "Indexes",
        objects: [{ name: "users_name_idx", kind: "index", table_name: "users" }],
      },
    ]);
  });

  it("defaults missing object kind to table", () => {
    expect(getDatabaseObjectKind({ name: "users" })).toBe("table");
  });

  it("keeps unknown object kinds visible as tables", () => {
    const extensionObject = { name: "events_stream", kind: "stream" } as unknown as TableInfo;

    expect(getDatabaseObjectKind(extensionObject)).toBe("table");
    expect(groupDatabaseObjects([extensionObject])).toEqual([
      { kind: "table", label: "Tables", objects: [extensionObject] },
    ]);
  });

  it("drops catalog objects with blank names", () => {
    expect(
      groupDatabaseObjects([
        { name: "users" },
        { name: "  ", kind: "view" },
        { name: "", kind: "index", table_name: "users" },
      ]),
    ).toEqual([{ kind: "table", label: "Tables", objects: [{ name: "users" }] }]);
  });

  it("reads index owners from snake_case or camelCase metadata", () => {
    expect(getDatabaseObjectOwner({ name: "idx_users", kind: "index", table_name: "users" })).toBe(
      "users",
    );
    expect(getDatabaseObjectOwner({ name: "idx_posts", kind: "index", tableName: "posts" })).toBe(
      "posts",
    );
  });

  it("normalizes empty object owner metadata", () => {
    expect(getDatabaseObjectOwner({ name: "idx_users", kind: "index", table_name: "  " })).toBe(
      null,
    );
    expect(getDatabaseObjectOwner({ name: "idx_posts", kind: "index", tableName: " posts " })).toBe(
      "posts",
    );
  });
});
