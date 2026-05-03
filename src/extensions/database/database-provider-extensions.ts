import { PLATFORM_ARCH } from "@/utils/platform";
import type {
  DatabaseProviderContribution,
  DatabaseProviderId,
  ExtensionManifest,
  PlatformArch,
  PlatformPackage,
} from "../types/extension-manifest";

const EXTENSION_CDN_BASE_URL =
  import.meta.env.VITE_EXTENSION_CDN_URL ||
  import.meta.env.VITE_PARSER_CDN_URL ||
  "https://athas.dev/extensions";

const PROVIDER_DEFINITIONS: Array<{
  extensionId: string;
  packageName: string;
  name: string;
  description: string;
  provider: DatabaseProviderContribution;
}> = [
  {
    extensionId: "athas.database.sqlite",
    packageName: "sqlite",
    name: "SQLite",
    description: "SQLite database browser and query provider.",
    provider: {
      id: "sqlite",
      label: "SQLite",
      isFileBased: true,
      fileExtensions: [".sqlite", ".db", ".sqlite3"],
      sidecar: {
        "darwin-arm64": "bin/athas-db-sqlite",
        "darwin-x64": "bin/athas-db-sqlite",
        "linux-arm64": "bin/athas-db-sqlite",
        "linux-x64": "bin/athas-db-sqlite",
        "win32-x64": "bin/athas-db-sqlite.exe",
      },
    },
  },
  {
    extensionId: "athas.database.duckdb",
    packageName: "duckdb",
    name: "DuckDB",
    description: "DuckDB database browser and query provider.",
    provider: {
      id: "duckdb",
      label: "DuckDB",
      isFileBased: true,
      fileExtensions: [".duckdb", ".duck"],
      sidecar: {
        "darwin-arm64": "bin/athas-db-duckdb",
        "darwin-x64": "bin/athas-db-duckdb",
        "linux-arm64": "bin/athas-db-duckdb",
        "linux-x64": "bin/athas-db-duckdb",
        "win32-x64": "bin/athas-db-duckdb.exe",
      },
    },
  },
  {
    extensionId: "athas.database.postgres",
    packageName: "postgres",
    name: "PostgreSQL",
    description: "PostgreSQL connection, schema, and query provider.",
    provider: {
      id: "postgres",
      label: "PostgreSQL",
      isFileBased: false,
      defaultPort: 5432,
      sidecar: {
        "darwin-arm64": "bin/athas-db-postgres",
        "darwin-x64": "bin/athas-db-postgres",
        "linux-arm64": "bin/athas-db-postgres",
        "linux-x64": "bin/athas-db-postgres",
        "win32-x64": "bin/athas-db-postgres.exe",
      },
    },
  },
  {
    extensionId: "athas.database.mysql",
    packageName: "mysql",
    name: "MySQL",
    description: "MySQL connection, schema, and query provider.",
    provider: {
      id: "mysql",
      label: "MySQL",
      isFileBased: false,
      defaultPort: 3306,
      sidecar: {
        "darwin-arm64": "bin/athas-db-mysql",
        "darwin-x64": "bin/athas-db-mysql",
        "linux-arm64": "bin/athas-db-mysql",
        "linux-x64": "bin/athas-db-mysql",
        "win32-x64": "bin/athas-db-mysql.exe",
      },
    },
  },
  {
    extensionId: "athas.database.mongodb",
    packageName: "mongodb",
    name: "MongoDB",
    description: "MongoDB connection, collection, and document provider.",
    provider: {
      id: "mongodb",
      label: "MongoDB",
      isFileBased: false,
      defaultPort: 27017,
      sidecar: {
        "darwin-arm64": "bin/athas-db-mongodb",
        "darwin-x64": "bin/athas-db-mongodb",
        "linux-arm64": "bin/athas-db-mongodb",
        "linux-x64": "bin/athas-db-mongodb",
        "win32-x64": "bin/athas-db-mongodb.exe",
      },
    },
  },
  {
    extensionId: "athas.database.redis",
    packageName: "redis",
    name: "Redis",
    description: "Redis connection, key scanning, and value editing provider.",
    provider: {
      id: "redis",
      label: "Redis",
      isFileBased: false,
      defaultPort: 6379,
      sidecar: {
        "darwin-arm64": "bin/athas-db-redis",
        "darwin-x64": "bin/athas-db-redis",
        "linux-arm64": "bin/athas-db-redis",
        "linux-x64": "bin/athas-db-redis",
        "win32-x64": "bin/athas-db-redis.exe",
      },
    },
  },
];

function buildPlatformPackages(
  packageName: string,
): Partial<Record<PlatformArch, PlatformPackage>> {
  const platforms = [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "win32-x64",
  ] as const;

  return Object.fromEntries(
    platforms.map((platformArch) => [
      platformArch,
      {
        downloadUrl: `${EXTENSION_CDN_BASE_URL}/database/${packageName}/${platformArch}.tar.gz`,
        size: 0,
        checksum: "",
      },
    ]),
  );
}

export function getDatabaseProviderExtensions(): ExtensionManifest[] {
  return PROVIDER_DEFINITIONS.map(({ extensionId, packageName, name, description, provider }) => ({
    id: extensionId,
    name,
    displayName: name,
    description,
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Database"],
    databaseProviders: [provider],
    activationEvents: [`onDatabase:${provider.id}`],
    license: "MIT",
    repository: {
      type: "git",
      url: "https://github.com/athasdev/extensions",
    },
    icon: "icon.svg",
    installation: {
      downloadUrl: `${EXTENSION_CDN_BASE_URL}/database/${packageName}/${PLATFORM_ARCH}.tar.gz`,
      size: 0,
      checksum: "",
      platformArch: buildPlatformPackages(packageName),
    },
  }));
}

export function getDatabaseProviderExtensionId(providerId: DatabaseProviderId): string {
  const definition = PROVIDER_DEFINITIONS.find((item) => item.provider.id === providerId);
  return definition?.extensionId ?? `athas.database.${providerId}`;
}

export function getDatabaseProviderContribution(
  providerId: DatabaseProviderId,
): DatabaseProviderContribution | undefined {
  return PROVIDER_DEFINITIONS.find((item) => item.provider.id === providerId)?.provider;
}
