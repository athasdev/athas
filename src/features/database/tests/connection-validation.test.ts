import { describe, expect, it } from "vite-plus/test";
import {
  getInstalledDatabaseTypes,
  validateConnectionInput,
} from "@/features/database/components/connection/connection-validation";

describe("database connection validation", () => {
  it("returns built-in database provider types in registry order", () => {
    const extensions = new Map([
      [
        "athas.database.redis",
        {
          isInstalled: true,
          manifest: { databases: [{ id: "redis", protocolVersion: 1 }] },
        },
      ],
      [
        "athas.database.postgres",
        {
          isInstalled: true,
          manifest: { databases: [{ id: " postgres ", protocolVersion: 1 }] },
        },
      ],
      [
        "athas.database.mysql",
        {
          isInstalled: false,
          manifest: { databases: [{ id: "mysql", protocolVersion: 1 }] },
        },
      ],
    ]);

    expect(getInstalledDatabaseTypes(extensions)).toEqual([
      "sqlite",
      "duckdb",
      "postgres",
      "mysql",
      "mongodb",
      "redis",
    ]);
  });

  it("does not hide built-in providers when extension metadata is incomplete", () => {
    const extensions = new Map([
      [
        "athas.database.sqlite",
        {
          isInstalled: true,
          manifest: { databases: [{ id: "sqlite" }] },
        },
      ],
      [
        "athas.database.postgres",
        {
          isInstalled: true,
          manifest: { databases: [{ id: "postgres", protocolVersion: 2 }] },
        },
      ],
      [
        "athas.database.redis",
        {
          isInstalled: true,
          manifest: { databases: [{ id: "redis", protocolVersion: 1 }] },
        },
      ],
    ]);

    expect(getInstalledDatabaseTypes(extensions)).toEqual([
      "sqlite",
      "duckdb",
      "postgres",
      "mysql",
      "mongodb",
      "redis",
    ]);
  });

  it("requires a file path for file-based providers", () => {
    expect(
      validateConnectionInput({
        dbType: "sqlite",
        isFileBased: true,
        mode: "form",
        filePath: "",
        host: "",
        port: 0,
        database: "",
        connectionString: "",
      }),
    ).toBe("Select a database file");
  });

  it("requires a connection string in string mode", () => {
    expect(
      validateConnectionInput({
        dbType: "postgres",
        isFileBased: false,
        mode: "string",
        filePath: "",
        host: "localhost",
        port: 5432,
        database: "app",
        connectionString: " ",
      }),
    ).toBe("Enter a connection string");
  });

  it("requires host, valid port, and database for network form providers", () => {
    const base = {
      dbType: "postgres" as const,
      isFileBased: false,
      mode: "form" as const,
      filePath: "",
      host: "localhost",
      port: 5432,
      database: "app",
      connectionString: "",
    };

    expect(validateConnectionInput({ ...base, host: "" })).toBe("Enter a host");
    expect(validateConnectionInput({ ...base, port: 70000 })).toBe("Enter a valid port");
    expect(validateConnectionInput({ ...base, database: "" })).toBe("Enter a database name");
    expect(validateConnectionInput(base)).toBeNull();
  });

  it("does not require a database name for Redis", () => {
    expect(
      validateConnectionInput({
        dbType: "redis",
        isFileBased: false,
        mode: "form",
        filePath: "",
        host: "localhost",
        port: 6379,
        database: "",
        connectionString: "",
      }),
    ).toBeNull();
  });
});
