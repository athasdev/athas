import type { ComponentType } from "react";
import type { DatabaseType } from "../models/provider.types";

export interface ProviderConfig {
  label: string;
  isFileBased: boolean;
  defaultPort?: number;
  fileExtensions?: string[];
  viewerComponent: () => Promise<{ default: ComponentType<any> }>;
}

export const PROVIDER_REGISTRY: Record<DatabaseType, ProviderConfig> = {
  sqlite: {
    label: "SQLite",
    isFileBased: true,
    fileExtensions: [".sqlite", ".db", ".sqlite3"],
    viewerComponent: () => import("./sqlite/sqlite-viewer"),
  },
  duckdb: {
    label: "DuckDB",
    isFileBased: true,
    fileExtensions: [".duckdb", ".duck"],
    viewerComponent: () => import("./duckdb/duckdb-viewer"),
  },
  postgres: {
    label: "PostgreSQL",
    isFileBased: false,
    defaultPort: 5432,
    viewerComponent: () => import("./postgres/postgres-viewer"),
  },
  mysql: {
    label: "MySQL",
    isFileBased: false,
    defaultPort: 3306,
    viewerComponent: () => import("./mysql/mysql-viewer"),
  },
  mongodb: {
    label: "MongoDB",
    isFileBased: false,
    defaultPort: 27017,
    viewerComponent: () => import("./mongodb/mongodb-viewer"),
  },
  redis: {
    label: "Redis",
    isFileBased: false,
    defaultPort: 6379,
    viewerComponent: () => import("./redis/redis-viewer"),
  },
};
