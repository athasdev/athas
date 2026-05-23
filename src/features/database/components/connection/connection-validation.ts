import type { DatabaseType } from "../../models/provider.types";

const CONNECTION_DB_TYPES: DatabaseType[] = [
  "sqlite",
  "duckdb",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
];

export interface DatabaseExtensionAvailability {
  isInstalled?: boolean;
  manifest: {
    databases?: Array<{ id: string; protocolVersion?: number }>;
    databaseProviders?: Array<{ id: string; protocolVersion?: number }>;
  };
}

export interface ConnectionValidationInput {
  dbType: DatabaseType;
  isFileBased: boolean;
  mode: "form" | "string";
  filePath: string;
  host: string;
  port: number;
  database: string;
  connectionString: string;
}

export function getInstalledDatabaseTypes(
  _availableExtensions: Map<string, DatabaseExtensionAvailability>,
): DatabaseType[] {
  return CONNECTION_DB_TYPES;
}

export function validateConnectionInput(input: ConnectionValidationInput): string | null {
  if (input.isFileBased) {
    return input.filePath.trim() ? null : "Select a database file";
  }

  if (input.mode === "string") {
    return input.connectionString.trim() ? null : "Enter a connection string";
  }

  if (!input.host.trim()) {
    return "Enter a host";
  }

  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    return "Enter a valid port";
  }

  if (input.dbType !== "redis" && !input.database.trim()) {
    return "Enter a database name";
  }

  return null;
}
