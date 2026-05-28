import type { DatabaseType } from "../models/provider.types";
import { PROVIDER_REGISTRY } from "../providers/provider-registry";

const FILE_DATABASE_TYPES: DatabaseType[] = ["sqlite", "duckdb"];

export const DATABASE_SIDEBAR_FILES_DROPPED_EVENT = "athas-database-sidebar-files-dropped";

export function getDatabaseTypeForFilePath(path: string): DatabaseType | null {
  const normalizedPath = path.toLowerCase();
  return (
    FILE_DATABASE_TYPES.find((type) =>
      PROVIDER_REGISTRY[type].fileExtensions?.some((extension) =>
        normalizedPath.endsWith(extension.toLowerCase()),
      ),
    ) ?? null
  );
}

export function getDroppedDatabaseFilePaths(paths: string[]): string[] {
  return paths.filter((path) => getDatabaseTypeForFilePath(path));
}
