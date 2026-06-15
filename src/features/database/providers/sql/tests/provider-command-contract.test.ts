import { describe, expect, it } from "vite-plus/test";
import type { DatabaseType } from "../../../types/provider.types";
import { getProviderIdForCommand } from "../../../services/database-provider-sidecar";
import { MONGODB_PROVIDER_COMMANDS } from "../../mongodb/stores/mongodb.store";
import { REDIS_PROVIDER_COMMANDS } from "../../redis/stores/redis.store";
import {
  getSqlProviderCommandMap,
  getSqlTableSchemaCommand,
  POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS,
} from "../stores/create-sql.store";

const SQL_PROVIDERS = [
  "sqlite",
  "duckdb",
  "postgres",
  "mysql",
] as const satisfies readonly DatabaseType[];

describe("SQL provider command contracts", () => {
  it.each(SQL_PROVIDERS)("maps shared SQL commands to the %s provider namespace", (provider) => {
    expect(getSqlProviderCommandMap(provider)).toEqual({
      getTables: `get_${provider}_tables`,
      query: `query_${provider}`,
      queryFiltered: `query_${provider}_filtered`,
      execute: `execute_${provider}`,
      insertRow: `insert_${provider}_row`,
      updateRow: `update_${provider}_row`,
      updateRowByValues: `update_${provider}_row_by_values`,
      deleteRow: `delete_${provider}_row`,
      deleteRowByValues: `delete_${provider}_row_by_values`,
      getForeignKeys: `get_${provider}_foreign_keys`,
    });
  });

  it.each(SQL_PROVIDERS)("resolves every %s SQL command to its provider", (provider) => {
    expect(Object.values(getSqlProviderCommandMap(provider)).map(getProviderIdForCommand)).toEqual(
      Array.from(
        { length: Object.keys(getSqlProviderCommandMap(provider)).length },
        () => provider,
      ),
    );
  });

  it.each([
    ["postgres", "get_postgres_table_schema"],
    ["mysql", "get_mysql_table_schema"],
  ] as const)("resolves %s table schema commands to its provider", (provider, command) => {
    expect(getSqlTableSchemaCommand(provider)).toBe(command);
    expect(getProviderIdForCommand(command)).toBe(provider);
  });

  it.each(["sqlite", "duckdb"] as const)(
    "does not expose a sidecar table schema command for %s",
    (provider) => {
      expect(getSqlTableSchemaCommand(provider)).toBeNull();
    },
  );

  it("resolves Postgres subscription commands to the postgres provider", () => {
    expect(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS).toEqual({
      getInfo: "get_postgres_subscription_info",
      getStatus: "get_postgres_subscription_status",
      create: "create_postgres_subscription",
      drop: "drop_postgres_subscription",
      setEnabled: "set_postgres_subscription_enabled",
      refresh: "refresh_postgres_subscription",
    });
    expect(
      Object.values(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS).map(getProviderIdForCommand),
    ).toEqual(
      Array.from(
        { length: Object.keys(POSTGRES_SUBSCRIPTION_PROVIDER_COMMANDS).length },
        () => "postgres",
      ),
    );
  });
});

describe("document and key-value provider command contracts", () => {
  it("keeps MongoDB commands in the mongo provider namespace", () => {
    expect(MONGODB_PROVIDER_COMMANDS).toEqual({
      getDatabases: "get_mongo_databases",
      getCollections: "get_mongo_collections",
      queryDocuments: "query_mongo_documents",
      insertDocument: "insert_mongo_document",
      updateDocument: "update_mongo_document",
      deleteDocument: "delete_mongo_document",
    });
    expect(Object.values(MONGODB_PROVIDER_COMMANDS).map(getProviderIdForCommand)).toEqual(
      Array.from({ length: Object.keys(MONGODB_PROVIDER_COMMANDS).length }, () => "mongodb"),
    );
  });

  it("keeps Redis commands in the redis provider namespace", () => {
    expect(REDIS_PROVIDER_COMMANDS).toEqual({
      scanKeys: "redis_scan_keys",
      getValue: "redis_get_value",
      setValue: "redis_set_value",
      deleteKey: "redis_delete_key",
      getInfo: "redis_get_info",
    });
    expect(Object.values(REDIS_PROVIDER_COMMANDS).map(getProviderIdForCommand)).toEqual(
      Array.from({ length: Object.keys(REDIS_PROVIDER_COMMANDS).length }, () => "redis"),
    );
  });
});
