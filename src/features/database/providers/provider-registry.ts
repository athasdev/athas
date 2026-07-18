import type { ComponentType } from "react";
import type { DatabaseType } from "../types/provider.types";

export type DatabaseViewerProps = { databasePath: string } | { connectionId: string };

type DatabaseViewerComponent = ComponentType<DatabaseViewerProps>;

const asDatabaseViewer = (component: ComponentType<never>): DatabaseViewerComponent =>
  component as DatabaseViewerComponent;

export interface ProviderConfig {
  label: string;
  isFileBased: boolean;
  defaultPort?: number;
  fileExtensions?: string[];
  viewerComponent: () => Promise<{ default: DatabaseViewerComponent }>;
}

export const PROVIDER_REGISTRY: Record<DatabaseType, ProviderConfig> = {
  sqlite: {
    label: "SQLite",
    isFileBased: true,
    fileExtensions: [".sqlite", ".db", ".sqlite3"],
    viewerComponent: () =>
      import("./sqlite/sqlite-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
  duckdb: {
    label: "DuckDB",
    isFileBased: true,
    fileExtensions: [".duckdb", ".duck"],
    viewerComponent: () =>
      import("./duckdb/duckdb-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
  postgres: {
    label: "PostgreSQL",
    isFileBased: false,
    defaultPort: 5432,
    viewerComponent: () =>
      import("./postgres/postgres-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
  mysql: {
    label: "MySQL",
    isFileBased: false,
    defaultPort: 3306,
    viewerComponent: () =>
      import("./mysql/mysql-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
  mongodb: {
    label: "MongoDB",
    isFileBased: false,
    defaultPort: 27017,
    viewerComponent: () =>
      import("./mongodb/mongodb-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
  redis: {
    label: "Redis",
    isFileBased: false,
    defaultPort: 6379,
    viewerComponent: () =>
      import("./redis/redis-viewer").then((module) => ({
        default: asDatabaseViewer(module.default),
      })),
  },
};
