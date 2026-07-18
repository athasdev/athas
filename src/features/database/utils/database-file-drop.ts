import type { DatabaseType } from "../types/provider.types";
import { PROVIDER_REGISTRY } from "../providers/provider-registry";

const FILE_DATABASE_TYPES: DatabaseType[] = ["sqlite", "duckdb"];

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
