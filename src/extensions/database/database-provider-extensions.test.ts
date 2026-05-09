import { describe, expect, it } from "vite-plus/test";
import { PROVIDER_REGISTRY } from "@/features/database/providers/provider-registry";
import type { DatabaseProviderId } from "../types/extension-manifest";
import { getDatabaseProviderContribution } from "./database-provider-extensions";

const DATABASE_PROVIDER_IDS = [
  "sqlite",
  "duckdb",
  "postgres",
  "mysql",
  "mongodb",
  "redis",
] as const satisfies readonly DatabaseProviderId[];

describe("database provider extension manifests", () => {
  it.each(DATABASE_PROVIDER_IDS)("declares protocol version for %s", (providerId) => {
    expect(getDatabaseProviderContribution(providerId)).toMatchObject({
      id: providerId,
      protocolVersion: 1,
    });
  });

  it.each(DATABASE_PROVIDER_IDS)("matches registry metadata for %s", (providerId) => {
    const contribution = getDatabaseProviderContribution(providerId);
    const registryConfig = PROVIDER_REGISTRY[providerId];

    expect(contribution).toMatchObject({
      id: providerId,
      label: registryConfig.label,
      isFileBased: registryConfig.isFileBased,
    });
    expect(contribution?.defaultPort).toBe(registryConfig.defaultPort);
    expect(contribution?.fileExtensions).toEqual(registryConfig.fileExtensions);
  });
});
