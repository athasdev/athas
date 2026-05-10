import { describe, expect, it, vi } from "vite-plus/test";
import { buildSavedConnectionConfig } from "./connection-config";

describe("database connection config", () => {
  it("normalizes form connection fields before saving or connecting", () => {
    expect(
      buildSavedConnectionConfig(
        {
          dbType: "postgres",
          mode: "form",
          name: "  Production  ",
          host: "  localhost  ",
          port: 5432,
          database: "  app  ",
          username: "  admin  ",
          connectionString: "postgres://ignored",
          filePath: "",
        },
        "pg-prod",
      ),
    ).toEqual({
      id: "pg-prod",
      name: "Production",
      db_type: "postgres",
      host: "localhost",
      port: 5432,
      database: "app",
      username: "admin",
      connection_string: undefined,
    });
  });

  it("uses provider defaults and trims connection strings", () => {
    expect(
      buildSavedConnectionConfig(
        {
          dbType: "mysql",
          mode: "string",
          name: "  ",
          host: "localhost",
          port: 3306,
          database: "app",
          username: "root",
          connectionString: "  mysql://root@localhost/app  ",
          filePath: "",
        },
        "mysql-local",
      ),
    ).toMatchObject({
      id: "mysql-local",
      name: "MySQL Connection",
      db_type: "mysql",
      connection_string: "mysql://root@localhost/app",
    });
  });

  it("falls back from invalid ids and ports before saving", () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);

    expect(
      buildSavedConnectionConfig(
        {
          dbType: "postgres",
          mode: "form",
          name: "Prod",
          host: "localhost",
          port: Number.NaN,
          database: "app",
          username: "admin",
          connectionString: "",
          filePath: "",
        },
        "   ",
      ),
    ).toMatchObject({
      id: "postgres-12345",
      port: 5432,
    });
  });

  it("does not truncate fractional ports before saving", () => {
    expect(
      buildSavedConnectionConfig(
        {
          dbType: "postgres",
          mode: "form",
          name: "Local",
          host: "localhost",
          port: 1234.8,
          database: "app",
          username: "admin",
          connectionString: "",
          filePath: "",
        },
        "pg-local",
      ),
    ).toMatchObject({
      id: "pg-local",
      port: 5432,
    });
  });

  it("keeps file database connections scoped to the workspace", () => {
    expect(
      buildSavedConnectionConfig(
        {
          dbType: "sqlite",
          mode: "form",
          name: "  Local data  ",
          host: "",
          port: 0,
          database: "",
          username: "",
          connectionString: "",
          filePath: "  /workspace/data.sqlite  ",
          workspacePath: "  /workspace  ",
        },
        "sqlite-local",
      ),
    ).toEqual({
      id: "sqlite-local",
      name: "Local data",
      db_type: "sqlite",
      workspace_path: "/workspace",
      file_path: "/workspace/data.sqlite",
      host: "",
      port: 0,
      database: "",
      username: "",
      connection_string: undefined,
    });
  });
});
