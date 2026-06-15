import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { DatabaseType } from "../types/provider.types";
import { getProviderIdForCommand, invokeDatabaseProvider } from "./database-provider-sidecar";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

describe("database provider sidecar service", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it.each([
    ["query_sqlite", "sqlite"],
    ["get_duckdb_tables", "duckdb"],
    ["create_postgres_subscription", "postgres"],
    ["get_mysql_table_schema", "mysql"],
    ["query_mongo_documents", "mongodb"],
    ["redis_scan_keys", "redis"],
  ] as const)("resolves %s to the %s provider", (command, provider) => {
    expect(getProviderIdForCommand(command)).toBe(provider);
  });

  it("does not resolve provider names embedded inside larger tokens", () => {
    expect(() => getProviderIdForCommand("query_presqlite_data")).toThrow(
      "Cannot resolve database provider for command query_presqlite_data",
    );
  });

  it("rejects commands that contain multiple provider tokens", () => {
    expect(() => getProviderIdForCommand("query_sqlite_postgres")).toThrow(
      "Ambiguous database provider command query_sqlite_postgres",
    );
  });

  it("invokes the Tauri database command with the resolved provider id", async () => {
    mockInvoke.mockResolvedValueOnce({ ok: true });

    await expect(
      invokeDatabaseProvider("query_duckdb", { path: "/tmp/app.duckdb" }),
    ).resolves.toEqual({
      ok: true,
    });

    expect(mockInvoke).toHaveBeenCalledWith("run_database_provider_command", {
      providerId: "duckdb",
      command: "query_duckdb",
      payload: { path: "/tmp/app.duckdb" },
    });
  });

  it("uses an explicit provider id when one is supplied", async () => {
    mockInvoke.mockResolvedValueOnce({ rows: [] });

    await invokeDatabaseProvider("custom_provider_command", { value: 1 }, "duckdb");

    expect(mockInvoke).toHaveBeenCalledWith("run_database_provider_command", {
      providerId: "duckdb",
      command: "custom_provider_command",
      payload: { value: 1 },
    });
  });

  it("normalizes explicit provider ids before invoking Tauri", async () => {
    mockInvoke.mockResolvedValueOnce({ rows: [] });

    await invokeDatabaseProvider(
      "custom_provider_command",
      { value: 1 },
      " duckdb " as DatabaseType,
    );

    expect(mockInvoke).toHaveBeenCalledWith("run_database_provider_command", {
      providerId: "duckdb",
      command: "custom_provider_command",
      payload: { value: 1 },
    });
  });

  it("normalizes provider commands before resolving and invoking", async () => {
    mockInvoke.mockResolvedValueOnce({ rows: [] });

    await invokeDatabaseProvider(" query_duckdb ", { path: "/tmp/app.duckdb" });

    expect(mockInvoke).toHaveBeenCalledWith("run_database_provider_command", {
      providerId: "duckdb",
      command: "query_duckdb",
      payload: { path: "/tmp/app.duckdb" },
    });
  });

  it("rejects empty provider commands before invoking Tauri", async () => {
    await expect(invokeDatabaseProvider(" ", {})).rejects.toThrow(
      "Database provider command is required",
    );

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects empty explicit provider commands before invoking Tauri", async () => {
    await expect(invokeDatabaseProvider(" ", {}, "duckdb")).rejects.toThrow(
      "Database provider command is required",
    );

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("rejects empty explicit provider ids before invoking Tauri", async () => {
    await expect(invokeDatabaseProvider("query_duckdb", {}, " " as DatabaseType)).rejects.toThrow(
      "Database provider id is required",
    );

    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
