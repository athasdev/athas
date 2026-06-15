import { describe, expect, it } from "vite-plus/test";
import type { DatabaseType } from "../types/provider.types";
import { PROVIDER_REGISTRY } from "./provider-registry";

const DATABASE_TYPES: DatabaseType[] = [
  "sqlite",
  "duckdb",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
];

describe("provider registry", () => {
  it("registers every supported database type", () => {
    expect(Object.keys(PROVIDER_REGISTRY)).toEqual(DATABASE_TYPES);
  });

  it("keeps file and connection provider metadata explicit", () => {
    expect(PROVIDER_REGISTRY.sqlite).toMatchObject({
      label: "SQLite",
      isFileBased: true,
      fileExtensions: [".sqlite", ".db", ".sqlite3"],
    });
    expect(PROVIDER_REGISTRY.duckdb).toMatchObject({
      label: "DuckDB",
      isFileBased: true,
      fileExtensions: [".duckdb", ".duck"],
    });
    expect(PROVIDER_REGISTRY.postgres).toMatchObject({
      label: "PostgreSQL",
      isFileBased: false,
      defaultPort: 5432,
    });
    expect(PROVIDER_REGISTRY.mysql).toMatchObject({
      label: "MySQL",
      isFileBased: false,
      defaultPort: 3306,
    });
    expect(PROVIDER_REGISTRY.mongodb).toMatchObject({
      label: "MongoDB",
      isFileBased: false,
      defaultPort: 27017,
    });
    expect(PROVIDER_REGISTRY.redis).toMatchObject({
      label: "Redis",
      isFileBased: false,
      defaultPort: 6379,
    });
  });

  it("declares a viewer loader for each provider", () => {
    for (const dbType of DATABASE_TYPES) {
      expect(typeof PROVIDER_REGISTRY[dbType].viewerComponent).toBe("function");
    }
  });
});
