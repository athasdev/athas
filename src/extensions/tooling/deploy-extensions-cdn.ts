#!/usr/bin/env bun

import { $ } from "bun";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { GENERATED_CDN_DIR } from "./extension-workspace";
import { SERVICE_DEFAULTS } from "@/config/service-defaults";

const targetDir = process.env.EXTENSIONS_CDN_ROOT;
const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || SERVICE_DEFAULTS.extensionsCdnBaseUrl;

if (!targetDir) {
  console.error("Missing EXTENSIONS_CDN_ROOT environment variable.");
  process.exit(1);
}

console.log("Syncing extensions CDN content...");
console.log(`Source: ${GENERATED_CDN_DIR}/`);
console.log(`Target: ${targetDir}/`);

await $`mkdir -p ${targetDir}`;
await $`rsync -az ${GENERATED_CDN_DIR}/ ${targetDir}/`;

type InstallablePackage = {
  url: string;
  size: number;
  checksum: string;
};

function collectInstallablePackages(value: unknown, packages: InstallablePackage[] = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectInstallablePackages(item, packages);
    return packages;
  }

  if (!value || typeof value !== "object") return packages;

  const entry = value as Record<string, unknown>;
  if (
    typeof entry.downloadUrl === "string" &&
    typeof entry.size === "number" &&
    entry.size > 0 &&
    typeof entry.checksum === "string" &&
    entry.checksum.length > 0
  ) {
    packages.push({
      url: entry.downloadUrl,
      size: entry.size,
      checksum: entry.checksum,
    });
  }

  for (const item of Object.values(entry)) collectInstallablePackages(item, packages);
  return packages;
}

async function sha256(path: string) {
  const bytes = await readFile(path);
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyInstallablePackages() {
  const manifests = JSON.parse(
    await readFile(join(GENERATED_CDN_DIR, "manifests.json"), "utf8"),
  ) as unknown;
  const cdnPrefix = `${cdnBaseUrl.replace(/\/$/, "")}/`;
  const failures: string[] = [];
  const installablePackages = new Map(
    collectInstallablePackages(manifests).map((installablePackage) => [
      installablePackage.url,
      installablePackage,
    ]),
  );

  for (const installablePackage of installablePackages.values()) {
    if (!installablePackage.url.startsWith(cdnPrefix)) continue;

    const relativePath = installablePackage.url.slice(cdnPrefix.length);
    const deployedPath = join(targetDir!, relativePath);

    try {
      const fileStats = await stat(deployedPath);
      const checksum = await sha256(deployedPath);
      if (fileStats.size !== installablePackage.size || checksum !== installablePackage.checksum) {
        failures.push(
          `${relativePath}: expected ${installablePackage.size}/${installablePackage.checksum}, got ${fileStats.size}/${checksum}`,
        );
      }
    } catch (error) {
      failures.push(`${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Extension CDN verification failed:\n${failures.join("\n")}`);
  }
}

await verifyInstallablePackages();

console.log("Extensions CDN sync complete.");
