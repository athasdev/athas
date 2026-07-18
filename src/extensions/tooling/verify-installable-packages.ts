#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GENERATED_CDN_DIR } from "./extension-workspace";
import { SERVICE_DEFAULTS } from "@/config/service-defaults";

type InstallablePackage = {
  url: string;
  size: number;
  checksum: string;
};

const cdnBaseUrl = process.env.EXTENSIONS_CDN_BASE_URL || SERVICE_DEFAULTS.extensionsCdnBaseUrl;

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

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyRemotePackage(installablePackage: InstallablePackage) {
  const url = new URL(installablePackage.url);
  url.searchParams.set("verify", String(Date.now()));

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return `HTTP ${response.status} for ${installablePackage.url}`;
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const checksum = sha256(bytes);

  if (bytes.byteLength !== installablePackage.size || checksum !== installablePackage.checksum) {
    return `${installablePackage.url}: expected ${installablePackage.size}/${installablePackage.checksum}, got ${bytes.byteLength}/${checksum}`;
  }

  return null;
}

const manifests = JSON.parse(
  await readFile(join(GENERATED_CDN_DIR, "manifests.json"), "utf8"),
) as unknown;
const cdnPrefix = `${cdnBaseUrl.replace(/\/$/, "")}/`;
const installablePackages = new Map(
  collectInstallablePackages(manifests)
    .filter((installablePackage) => installablePackage.url.startsWith(cdnPrefix))
    .map((installablePackage) => [installablePackage.url, installablePackage]),
);

const failures: string[] = [];

for (const installablePackage of installablePackages.values()) {
  const failure = await verifyRemotePackage(installablePackage);
  if (failure) failures.push(failure);
}

if (failures.length > 0) {
  console.error(`Extension package verification failed:\n${failures.join("\n")}`);
  process.exit(1);
}

console.log(`Verified ${installablePackages.size} installable extension package(s).`);
